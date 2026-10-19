import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { BaseService } from '@Common';
import { RedisService } from '../redis';

export interface ResumeFingerprintRecord {
  fingerprint: string;
  candidateId?: number;
  gmailMessageId?: string;
  attachmentId?: string;
  filename?: string;
  senderEmail?: string;
  processedAt: string;
  status: 'COMPLETED' | 'PROCESSING' | 'FAILED';
}

@Injectable()
export class ResumeFingerprintService
  extends BaseService
  implements OnModuleInit
{
  private static readonly REDIS_SET_KEY = 'recruitment:resume:fingerprints';
  private static readonly REDIS_LOCK_PREFIX = 'recruitment:resume:lock:';
  private static readonly REDIS_META_PREFIX = 'recruitment:resume:meta:';
  private static readonly LOCK_TTL_SECONDS = 120;

  private readonly storageFilePath = path.resolve(
    process.cwd(),
    'data',
    'resume-fingerprints.json',
  );

  // In-memory fallback and fast local cache
  private readonly memoryCache = new Set<string>();

  constructor(private readonly redisService: RedisService) {
    super({ loggerDefaultMeta: { service: ResumeFingerprintService.name } });
  }

  async onModuleInit(): Promise<void> {
    await this.initStorage();
  }

  /**
   * Initializes local persistent file storage and seeds Redis with known fingerprints.
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
          const records: ResumeFingerprintRecord[] = JSON.parse(raw);
          if (Array.isArray(records)) {
            for (const rec of records) {
              if (rec.fingerprint && rec.status === 'COMPLETED') {
                const normalized = rec.fingerprint.trim().toLowerCase();
                this.memoryCache.add(normalized);
                if (this.redisService?.client) {
                  await this.redisService.client
                    .sadd(ResumeFingerprintService.REDIS_SET_KEY, normalized)
                    .catch(() => {});
                }
              }
            }
            this.logger.info(
              `Loaded ${this.memoryCache.size} persistent resume fingerprints into memory and Redis cache`,
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
        `Failed to initialize resume fingerprint storage: ${err.message}`,
      );
    }
  }

  /**
   * Computes normalized SHA-256 hexadecimal hash of attachment bytes.
   */
  computeFingerprint(buffer: Buffer): string {
    if (!buffer || buffer.length === 0) {
      throw new Error('Cannot compute fingerprint of empty buffer');
    }
    return crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex')
      .toLowerCase();
  }

  /**
   * Checks whether a resume fingerprint has already been successfully processed.
   * Checks Redis Set first, with in-memory / file fallback.
   */
  async isFingerprintProcessed(fingerprint: string): Promise<boolean> {
    if (!fingerprint) return false;
    const normalized = fingerprint.trim().toLowerCase();

    // 1. Check in-memory fast cache
    if (this.memoryCache.has(normalized)) {
      return true;
    }

    // 2. Check Redis Set
    if (this.redisService?.client) {
      try {
        const isMember = await this.redisService.client.sismember(
          ResumeFingerprintService.REDIS_SET_KEY,
          normalized,
        );
        if (isMember === 1) {
          this.memoryCache.add(normalized);
          return true;
        }
      } catch (redisErr: any) {
        this.logger.warn(
          `Redis lookup for fingerprint failed: ${redisErr.message}; relying on local cache`,
        );
      }
    }

    return false;
  }

  /**
   * Acquires an atomic distributed lock in Redis for the given fingerprint.
   * Prevents two concurrent polling workers from processing the same resume simultaneously.
   */
  async acquireProcessingLock(
    fingerprint: string,
  ): Promise<{ acquired: boolean; lockToken?: string }> {
    const normalized = fingerprint.trim().toLowerCase();
    const lockToken = crypto.randomUUID();
    const lockKey = `${ResumeFingerprintService.REDIS_LOCK_PREFIX}${normalized}`;

    if (this.redisService?.client) {
      try {
        const res = await this.redisService.client.set(
          lockKey,
          lockToken,
          'EX',
          ResumeFingerprintService.LOCK_TTL_SECONDS,
          'NX',
        );
        return {
          acquired: res === 'OK',
          lockToken: res === 'OK' ? lockToken : undefined,
        };
      } catch (err: any) {
        this.logger.warn(
          `Redis lock attempt failed for fingerprint: ${err.message}; allowing local processing`,
        );
        return { acquired: true, lockToken };
      }
    }

    return { acquired: true, lockToken };
  }

  /**
   * Safely releases the processing lock if held by the provided lockToken.
   */
  async releaseProcessingLock(
    fingerprint: string,
    lockToken?: string,
  ): Promise<void> {
    if (!fingerprint || !this.redisService?.client) return;
    const normalized = fingerprint.trim().toLowerCase();
    const lockKey = `${ResumeFingerprintService.REDIS_LOCK_PREFIX}${normalized}`;

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
        `Could not release lock for fingerprint: ${err.message}`,
      );
    }
  }

  /**
   * Marks a resume fingerprint as COMPLETED in Redis and persistent storage.
   */
  async markFingerprintProcessed(
    fingerprint: string,
    record: Omit<ResumeFingerprintRecord, 'fingerprint' | 'status'> & {
      status?: 'COMPLETED' | 'PROCESSING' | 'FAILED';
    },
  ): Promise<void> {
    const normalized = fingerprint.trim().toLowerCase();
    const fullRecord: ResumeFingerprintRecord = {
      fingerprint: normalized,
      candidateId: record.candidateId,
      gmailMessageId: record.gmailMessageId,
      attachmentId: record.attachmentId,
      filename: record.filename,
      senderEmail: record.senderEmail,
      processedAt: record.processedAt || new Date().toISOString(),
      status: record.status || 'COMPLETED',
    };

    // 1. Update memory cache
    this.memoryCache.add(normalized);

    // 2. Update Redis
    if (this.redisService?.client) {
      try {
        await this.redisService.client.sadd(
          ResumeFingerprintService.REDIS_SET_KEY,
          normalized,
        );
        await this.redisService.client.set(
          `${ResumeFingerprintService.REDIS_META_PREFIX}${normalized}`,
          JSON.stringify(fullRecord),
          'EX',
          86400 * 365, // 1 year
        );
      } catch (redisErr: any) {
        this.logger.warn(
          `Redis save failed for fingerprint: ${redisErr.message}`,
        );
      }
    }

    // 3. Update persistent file storage atomically
    try {
      let existingRecords: ResumeFingerprintRecord[] = [];
      if (fs.existsSync(this.storageFilePath)) {
        try {
          const raw = await fs.promises.readFile(this.storageFilePath, 'utf-8');
          existingRecords = JSON.parse(raw);
          if (!Array.isArray(existingRecords)) existingRecords = [];
        } catch {}
      }

      const filtered = existingRecords.filter(
        (r) => r.fingerprint !== normalized,
      );
      filtered.push(fullRecord);

      const tempPath = `${this.storageFilePath}.tmp.${process.pid}.${Date.now()}`;
      await fs.promises.writeFile(
        tempPath,
        JSON.stringify(filtered, null, 2),
        'utf-8',
      );
      await fs.promises.rename(tempPath, this.storageFilePath);
    } catch (fileErr: any) {
      this.logger.warn(
        `Failed to persist fingerprint record to ${this.storageFilePath}: ${fileErr.message}`,
      );
    }
  }

  /**
   * Retrieves persistent metadata for a processed resume fingerprint.
   */
  async getFingerprintRecord(
    fingerprint: string,
  ): Promise<ResumeFingerprintRecord | null> {
    if (!fingerprint) return null;
    const normalized = fingerprint.trim().toLowerCase();

    if (this.redisService?.client) {
      try {
        const raw = await this.redisService.client.get(
          `${ResumeFingerprintService.REDIS_META_PREFIX}${normalized}`,
        );
        if (raw) {
          return JSON.parse(raw);
        }
      } catch {}
    }

    if (fs.existsSync(this.storageFilePath)) {
      try {
        const raw = await fs.promises.readFile(this.storageFilePath, 'utf-8');
        const records: ResumeFingerprintRecord[] = JSON.parse(raw);
        if (Array.isArray(records)) {
          const found = records.find((r) => r.fingerprint === normalized);
          if (found) return found;
        }
      } catch {}
    }

    return null;
  }
}
