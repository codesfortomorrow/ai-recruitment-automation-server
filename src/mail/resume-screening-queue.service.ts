import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { BaseService } from '@Common';
import { geminiConfigFactory } from '@Config';
import { RedisService } from '../redis';
import { ScreeningJob, ScreeningJobStatus } from './gemini.types';

export interface CreateScreeningJobInput {
  fingerprint: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType?: string;
  fileSize?: number;
  sender: {
    email: string;
    name?: string;
  };
  subject: string;
  receivedDate?: Date | string;
  emailBody?: string;
  extractedResumeText: string;
  jobRole?: string;
}

@Injectable()
export class ResumeScreeningQueueService
  extends BaseService
  implements OnModuleInit
{
  private static readonly REDIS_JOBS_HASH = 'recruitment:screening:jobs';
  private static readonly REDIS_LOCK_PREFIX = 'recruitment:screening:lock:';
  private static readonly LOCK_TTL_SECONDS = 120;
  private static readonly STALE_JOB_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  private readonly storageFilePath = path.resolve(
    process.cwd(),
    'data',
    process.env.NODE_ENV === 'test'
      ? 'screening-jobs.test.json'
      : 'screening-jobs.json',
  );

  // In-memory cache for fast lookups and fallback
  private readonly memoryJobs = new Map<string, ScreeningJob>();

  constructor(
    private readonly redisService: RedisService,
    @Inject(geminiConfigFactory.KEY)
    private readonly config: ConfigType<typeof geminiConfigFactory>,
  ) {
    super({
      loggerDefaultMeta: { service: ResumeScreeningQueueService.name },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.initStorage();
  }

  /**
   * Initializes durable file storage and synchronizes with Redis.
   * Recovers any jobs left in PROCESSING state after a server restart.
   */
  private async initStorage(): Promise<void> {
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.storageFilePath)) {
        const raw = await fs.promises.readFile(this.storageFilePath, 'utf-8');
        try {
          const fileJobs: ScreeningJob[] = JSON.parse(raw);
          if (Array.isArray(fileJobs)) {
            for (const job of fileJobs) {
              if (job && job.id) {
                // Stale job recovery on startup: if job was PROCESSING during restart, recover to RETRY_WAIT
                if (job.status === 'PROCESSING') {
                  this.logger.warn(
                    `Recovering stale PROCESSING job ${job.id} on server restart -> RETRY_WAIT`,
                    { jobId: job.id, attemptCount: job.attemptCount },
                  );
                  job.status = 'RETRY_WAIT';
                  job.nextRetryAt = Date.now();
                  job.updatedAt = new Date().toISOString();
                }

                this.memoryJobs.set(job.id, job);

                if (this.redisService?.client) {
                  await this.redisService.client
                    .hset(
                      ResumeScreeningQueueService.REDIS_JOBS_HASH,
                      job.id,
                      JSON.stringify(job),
                    )
                    .catch(() => {});
                }
              }
            }
            this.logger.info(
              `Loaded ${this.memoryJobs.size} durable screening jobs into memory and Redis cache`,
            );
          }
        } catch (jsonErr: any) {
          this.logger.warn(
            `Could not parse ${this.storageFilePath}: ${jsonErr.message}`,
          );
        }
      } else {
        await fs.promises.writeFile(this.storageFilePath, '[]', 'utf-8');
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to initialize resume screening queue storage: ${err.message}`,
      );
    }
  }

  /**
   * Atomically flushes memory cache to disk.
   */
  private async persistToFile(): Promise<void> {
    try {
      const list = Array.from(this.memoryJobs.values());
      const tempPath = `${this.storageFilePath}.tmp.${process.pid}.${Date.now()}`;
      await fs.promises.writeFile(
        tempPath,
        JSON.stringify(list, null, 2),
        'utf-8',
      );
      await fs.promises.rename(tempPath, this.storageFilePath);
    } catch (err: any) {
      this.logger.warn(
        `Failed to persist screening jobs to ${this.storageFilePath}: ${err.message}`,
      );
    }
  }

  /**
   * Enqueues or returns an existing screening job for a resume.
   * If a job already exists for this fingerprint, returns the existing job to prevent duplicates.
   */
  async enqueueJob(input: CreateScreeningJobInput): Promise<ScreeningJob> {
    const jobId = input.fingerprint.trim().toLowerCase();
    const existing = await this.getJob(jobId);

    if (existing) {
      this.logger.info(
        `Screening job already exists for fingerprint ${jobId} (status: ${existing.status})`,
        {
          jobId,
          status: existing.status,
          attempts: existing.attemptCount,
        },
      );
      return existing;
    }

    const now = new Date().toISOString();
    const maxAttempts = this.config.maxAttempts || 5;

    const newJob: ScreeningJob = {
      id: jobId,
      fingerprint: jobId,
      messageId: input.messageId,
      attachmentId: input.attachmentId,
      filename: input.filename,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      sender: input.sender,
      subject: input.subject,
      receivedDate: input.receivedDate
        ? new Date(input.receivedDate).toISOString()
        : undefined,
      emailBody: input.emailBody,
      extractedResumeText: input.extractedResumeText, // Durable extracted text
      jobRole: input.jobRole,
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts,
      nextRetryAt: Date.now(),
      createdAt: now,
      updatedAt: now,
    };

    await this.updateJob(newJob);

    this.logger.info(
      `Enqueued new screening job for resume fingerprint ${jobId}`,
      {
        jobId,
        filename: input.filename,
        messageId: input.messageId,
        attachmentId: input.attachmentId,
      },
    );

    return newJob;
  }

  /**
   * Retrieves a single screening job by its ID (fingerprint).
   */
  async getJob(jobId: string): Promise<ScreeningJob | null> {
    if (!jobId) return null;
    const normalized = jobId.trim().toLowerCase();

    // 1. Check Redis Hash
    if (this.redisService?.client) {
      try {
        const raw = await this.redisService.client.hget(
          ResumeScreeningQueueService.REDIS_JOBS_HASH,
          normalized,
        );
        if (raw) {
          const parsed = JSON.parse(raw);
          this.memoryJobs.set(normalized, parsed);
          return parsed;
        }
      } catch (err: any) {
        this.logger.warn(
          `Redis lookup failed for job ${normalized}: ${err.message}`,
        );
      }
    }

    // 2. Check memory cache
    return this.memoryJobs.get(normalized) || null;
  }

  /**
   * Updates a screening job in memory, Redis, and disk storage.
   */
  async updateJob(job: ScreeningJob): Promise<void> {
    const normalized = job.id.trim().toLowerCase();
    job.updatedAt = job.updatedAt || new Date().toISOString();

    // 1. Memory cache
    this.memoryJobs.set(normalized, job);

    // 2. Redis Hash
    if (this.redisService?.client) {
      try {
        await this.redisService.client.hset(
          ResumeScreeningQueueService.REDIS_JOBS_HASH,
          normalized,
          JSON.stringify(job),
        );
      } catch (redisErr: any) {
        this.logger.warn(
          `Failed to update job ${normalized} in Redis: ${redisErr.message}`,
        );
      }
    }

    // 3. Persistent disk storage
    await this.persistToFile();
  }

  /**
   * Retrieves all jobs currently due for processing or retry.
   */
  async getDueJobs(limit = 10): Promise<ScreeningJob[]> {
    const now = Date.now();
    const allJobs = Array.from(this.memoryJobs.values());

    return allJobs
      .filter(
        (job) =>
          (job.status === 'PENDING' || job.status === 'RETRY_WAIT') &&
          job.nextRetryAt <= now,
      )
      .sort((a, b) => a.nextRetryAt - b.nextRetryAt)
      .slice(0, limit);
  }

  /**
   * Recovers jobs that have been stuck in PROCESSING longer than threshold.
   */
  async recoverStaleJobs(
    staleThresholdMs = ResumeScreeningQueueService.STALE_JOB_THRESHOLD_MS,
  ): Promise<number> {
    const now = Date.now();
    let recoveredCount = 0;

    for (const job of this.memoryJobs.values()) {
      if (job.status === 'PROCESSING') {
        const lastUpdated = new Date(job.updatedAt).getTime();
        if (now - lastUpdated > staleThresholdMs) {
          this.logger.warn(
            `Recovering stale PROCESSING job ${job.id} (stuck for ${Math.round(
              (now - lastUpdated) / 1000,
            )}s) -> RETRY_WAIT`,
            {
              jobId: job.id,
              attemptCount: job.attemptCount,
            },
          );

          job.status = 'RETRY_WAIT';
          job.nextRetryAt = now;
          job.updatedAt = new Date().toISOString();
          job.lastError =
            'Job execution timed out or worker crashed during processing';
          await this.updateJob(job);
          recoveredCount++;
        }
      }
    }

    return recoveredCount;
  }

  /**
   * Lists screening jobs with optional filtering by status and pagination.
   */
  async listJobs(options?: {
    status?: ScreeningJobStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ total: number; jobs: ScreeningJob[] }> {
    let list = Array.from(this.memoryJobs.values());

    if (options?.status) {
      list = list.filter((j) => j.status === options.status);
    }

    // Sort by createdAt descending
    list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = list.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || 50;
    const paged = list.slice(offset, offset + limit);

    return { total, jobs: paged };
  }

  /**
   * Manually resets a job to PENDING so it can be retried immediately.
   */
  async retryJobManually(jobId: string): Promise<ScreeningJob> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Screening job with ID "${jobId}" not found`);
    }

    job.status = 'PENDING';
    job.nextRetryAt = Date.now();
    job.lastError = undefined;
    job.attemptCount = 0;
    await this.updateJob(job);

    this.logger.info(
      `Manually reset screening job ${jobId} to PENDING for retry`,
      {
        jobId,
      },
    );

    return job;
  }

  /**
   * Acquires an atomic distributed lock in Redis for the given screening job.
   */
  async acquireJobLock(
    jobId: string,
    ttlSeconds = ResumeScreeningQueueService.LOCK_TTL_SECONDS,
  ): Promise<{ acquired: boolean; lockToken?: string }> {
    const lockToken = crypto.randomUUID();
    const lockKey = `${ResumeScreeningQueueService.REDIS_LOCK_PREFIX}${jobId}`;

    if (this.redisService?.client) {
      try {
        const res = await this.redisService.client.set(
          lockKey,
          lockToken,
          'EX',
          ttlSeconds,
          'NX',
        );
        return {
          acquired: res === 'OK',
          lockToken: res === 'OK' ? lockToken : undefined,
        };
      } catch (err: any) {
        this.logger.warn(
          `Redis lock attempt failed for job ${jobId}: ${err.message}`,
        );
        return { acquired: true, lockToken };
      }
    }

    return { acquired: true, lockToken };
  }

  /**
   * Safely releases the processing lock if held by the provided lockToken.
   */
  async releaseJobLock(jobId: string, lockToken?: string): Promise<void> {
    if (!jobId || !this.redisService?.client) return;
    const lockKey = `${ResumeScreeningQueueService.REDIS_LOCK_PREFIX}${jobId}`;

    try {
      if (lockToken) {
        const luaScript = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;
        await this.redisService.client.eval(luaScript, 1, lockKey, lockToken);
      } else {
        await this.redisService.client.del(lockKey);
      }
    } catch (err: any) {
      this.logger.warn(
        `Could not release lock for job ${jobId}: ${err.message}`,
      );
    }
  }

  /**
   * Helper for unit tests to clear all memory and disk queue state.
   */
  async clearStorageForTesting(): Promise<void> {
    this.memoryJobs.clear();
    try {
      if (fs.existsSync(this.storageFilePath)) {
        await fs.promises.unlink(this.storageFilePath);
      }
    } catch {
      // ignore
    }
  }
}
