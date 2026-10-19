import {
  forwardRef,
  Inject,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BaseService } from '@Common';
import { geminiConfigFactory } from '@Config';
import { GeminiService } from './gemini.service';
import { ResumeFingerprintService } from './resume-fingerprint.service';
import { CandidateService } from '../candidate/candidate.service';
import { ResumeScreeningQueueService } from './resume-screening-queue.service';
import { ScreeningJob } from './gemini.types';
import { calculateBackoffWithJitter } from './gemini-error.classifier';
import { GmailMessageDetail } from './gmail.types';
import { GmailService } from './gmail.service';

@Injectable()
export class ResumeScreeningWorkerService
  extends BaseService
  implements OnModuleInit
{
  private isProcessing = false;

  constructor(
    private readonly queueService: ResumeScreeningQueueService,
    private readonly geminiService: GeminiService,
    private readonly resumeFingerprintService: ResumeFingerprintService,
    @Inject(geminiConfigFactory.KEY)
    private readonly config: ConfigType<typeof geminiConfigFactory>,
    @Optional()
    @Inject(forwardRef(() => CandidateService))
    private readonly candidateService?: CandidateService,
    @Optional()
    @Inject(forwardRef(() => GmailService))
    private readonly gmailService?: GmailService,
  ) {
    super({
      loggerDefaultMeta: { service: ResumeScreeningWorkerService.name },
    });
  }

  onModuleInit(): void {
    this.logger.info(
      'Resume screening retry worker initialized with durable backoff handling',
      {
        initialRetryDelayMs: this.config.initialRetryDelayMs,
        maxRetryDelayMs: this.config.maxRetryDelayMs,
        maxAttempts: this.config.maxAttempts,
        maxRetryAgeMs: this.config.maxRetryAgeMs,
        maxConcurrentRequests: this.config.maxConcurrentRequests,
      },
    );
  }

  /**
   * Periodic cron trigger for processing pending and retry-waiting screening jobs.
   * Runs every 10 seconds (or configured interval).
   * Fully decoupled from Gmail inbox polling and Google Sheets synchronization.
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async processDueJobsCron(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      // 1. Recover any jobs stuck in PROCESSING longer than 5 minutes
      await this.queueService.recoverStaleJobs();

      // 2. Fetch jobs currently due
      const limit = Math.max(1, this.config.maxConcurrentRequests || 2);
      const dueJobs = await this.queueService.getDueJobs(limit);

      if (dueJobs.length === 0) {
        return;
      }

      this.logger.info(
        `Resume screening retry worker found ${dueJobs.length} due job(s)`,
        {
          dueCount: dueJobs.length,
        },
      );

      // 3. Process jobs with bounded concurrency
      await Promise.all(dueJobs.map((job) => this.processSingleJob(job)));
    } catch (err: any) {
      this.logger.error('Error during screening worker execution', {
        cause: err.message,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Processes a single screening job end-to-end.
   * Handles immediate analysis, transient backoff scheduling, and dead-lettering.
   */
  async processSingleJob(job: ScreeningJob): Promise<ScreeningJob> {
    const lock = await this.queueService.acquireJobLock(job.id);
    if (!lock.acquired) {
      this.logger.warn(
        `Screening job ${job.id} is already being processed by another worker; skipping concurrent execution`,
        { jobId: job.id },
      );
      return job;
    }

    try {
      // Refresh job state
      const currentJob = (await this.queueService.getJob(job.id)) || job;

      // 1. Check if already COMPLETED
      if (currentJob.status === 'COMPLETED') {
        this.logger.info(
          `Screening job ${currentJob.id} is already completed; skipping`,
          {
            jobId: currentJob.id,
          },
        );
        return currentJob;
      }

      // 2. Check maximum retry age
      const now = Date.now();
      const jobAgeMs = now - new Date(currentJob.createdAt).getTime();
      const maxAgeMs = this.config.maxRetryAgeMs || 24 * 60 * 60 * 1000;

      if (jobAgeMs > maxAgeMs) {
        currentJob.status = 'FAILED_PERMANENTLY';
        currentJob.lastError = `Screening job exceeded maximum retry age (${maxAgeMs}ms; age was ${jobAgeMs}ms)`;
        await this.queueService.updateJob(currentJob);

        this.logger.error(
          `Screening job ${currentJob.id} moved to dead-letter state (FAILED_PERMANENTLY): Exceeded maximum retry age`,
          {
            jobId: currentJob.id,
            fingerprint: currentJob.fingerprint,
            attempts: currentJob.attemptCount,
            ageMs: jobAgeMs,
          },
        );

        return currentJob;
      }

      // 3. Check attempt count
      if (currentJob.attemptCount >= currentJob.maxAttempts) {
        currentJob.status = 'FAILED_PERMANENTLY';
        currentJob.lastError = `Screening job exceeded maximum attempts (${currentJob.maxAttempts})`;
        await this.queueService.updateJob(currentJob);

        this.logger.error(
          `Screening job ${currentJob.id} moved to dead-letter state (FAILED_PERMANENTLY): Exceeded max retry attempts`,
          {
            jobId: currentJob.id,
            fingerprint: currentJob.fingerprint,
            attempts: currentJob.attemptCount,
            maxAttempts: currentJob.maxAttempts,
          },
        );

        return currentJob;
      }

      // 4. Mark job as PROCESSING
      currentJob.status = 'PROCESSING';
      await this.queueService.updateJob(currentJob);

      this.logger.info(`Processing resume screening job for ${currentJob.id}`, {
        jobId: currentJob.id,
        filename: currentJob.filename,
        attempt: currentJob.attemptCount + 1,
        maxAttempts: currentJob.maxAttempts,
      });

      // If extractedResumeText is suspiciously short (e.g. from an earlier extraction before OCR),
      // re-extract with OCR if gmailService is available
      if (
        this.geminiService.isSuspiciouslyShortText(
          currentJob.extractedResumeText,
        ) &&
        this.gmailService &&
        currentJob.messageId &&
        currentJob.attachmentId
      ) {
        try {
          const buffer = await this.gmailService.downloadAttachment(
            currentJob.messageId,
            currentJob.attachmentId,
          );
          const reExtracted = await this.gmailService.extractResumeText(buffer);
          if (
            reExtracted.text &&
            !this.geminiService.isSuspiciouslyShortText(reExtracted.text)
          ) {
            currentJob.extractedResumeText = reExtracted.text;
            await this.queueService.updateJob(currentJob);
            this.logger.info(
              `Re-extracted ${reExtracted.text.length} characters using OCR for job ${currentJob.id}`,
              { jobId: currentJob.id },
            );
          }
        } catch (reErr: any) {
          this.logger.warn(
            `Failed to re-extract attachment text via OCR for job ${currentJob.id}: ${reErr.message}`,
          );
        }
      }

      // 5. Execute Gemini Analysis using already extracted resume text (NO PDF/DOCX re-download or re-parse unless insufficient!)
      const analysisResult = await this.geminiService.analyzeApplication({
        messageId: currentJob.messageId,
        subject: currentJob.subject,
        sender: currentJob.sender,
        recipient: 'me',
        receivedDate: currentJob.receivedDate,
        emailBody: currentJob.emailBody,
        resumeText: currentJob.extractedResumeText,
        filename: currentJob.filename,
        attachmentId: currentJob.attachmentId,
        jobRole: currentJob.jobRole,
      });

      analysisResult.fingerprint = currentJob.fingerprint;

      // 6. Handle Analysis Result
      if (analysisResult.status === 'success' && analysisResult.analysis) {
        // AI screening succeeded!
        let candidateId: number | undefined;

        if (this.candidateService) {
          const mockDetail: GmailMessageDetail = {
            id: currentJob.messageId,
            threadId: currentJob.messageId,
            sender: currentJob.sender,
            recipient: 'me',
            subject: currentJob.subject,
            receivedDate: currentJob.receivedDate
              ? new Date(currentJob.receivedDate)
              : new Date(),
            snippet: currentJob.subject,
            textBody: currentJob.emailBody,
            attachments: [
              {
                filename: currentJob.filename,
                mimeType: currentJob.mimeType || 'application/pdf',
                size: currentJob.fileSize || 0,
                attachmentId: currentJob.attachmentId,
              },
            ],
            resumes: [
              {
                attachmentId: currentJob.attachmentId,
                filename: currentJob.filename,
                mimeType: currentJob.mimeType || 'application/pdf',
                size: currentJob.fileSize || 0,
                status: 'success',
                text: currentJob.extractedResumeText,
                fingerprint: currentJob.fingerprint,
              },
            ],
          };

          const candidateRecord =
            await this.candidateService.persistAndProcessScreeningResult({
              messageDetail: mockDetail,
              analysisResult,
              candidateId: currentJob.candidateId,
              forceUpdate: true,
            });

          candidateId = candidateRecord?.id || currentJob.candidateId;
        }

        // Mark resume fingerprint as COMPLETED
        await this.resumeFingerprintService.markFingerprintProcessed(
          currentJob.fingerprint,
          {
            candidateId,
            gmailMessageId: currentJob.messageId,
            attachmentId: currentJob.attachmentId,
            filename: currentJob.filename,
            senderEmail: currentJob.sender.email,
            processedAt: new Date().toISOString(),
            status: 'COMPLETED',
          },
        );

        // Update job state to COMPLETED
        currentJob.status = 'COMPLETED';
        currentJob.completedAt = new Date().toISOString();
        currentJob.candidateId = candidateId;
        currentJob.lastError = undefined;
        await this.queueService.updateJob(currentJob);

        this.logger.info(
          `Screening job ${currentJob.id} completed successfully; candidate record persisted`,
          {
            jobId: currentJob.id,
            fingerprint: currentJob.fingerprint,
            candidateId,
            screeningStatus: analysisResult.analysis.screeningStatus,
            matchScore: analysisResult.analysis.matchScore,
            attempts: currentJob.attemptCount + 1,
          },
        );

        return currentJob;
      }

      // 7. Handle Failures
      const isPermanent = Boolean(analysisResult.isPermanent);

      if (isPermanent) {
        currentJob.status = 'FAILED_PERMANENTLY';
        currentJob.lastError =
          analysisResult.error || 'Permanent analysis failure';
        currentJob.lastHttpStatus = analysisResult.httpStatus;
        await this.queueService.updateJob(currentJob);

        this.logger.error(
          `Screening job ${currentJob.id} failed permanently; will not retry`,
          {
            jobId: currentJob.id,
            fingerprint: currentJob.fingerprint,
            httpStatus: analysisResult.httpStatus,
            error: currentJob.lastError,
          },
        );

        return currentJob;
      }

      // Transient failure (e.g. 503 UNAVAILABLE, 429 rate limit, timeout)
      currentJob.attemptCount += 1;
      currentJob.lastError =
        analysisResult.error || 'Transient analysis failure';
      currentJob.lastHttpStatus = analysisResult.httpStatus;

      if (currentJob.attemptCount >= currentJob.maxAttempts) {
        // Retry limit exhausted -> Dead Letter State
        currentJob.status = 'FAILED_PERMANENTLY';
        currentJob.lastError = `Exceeded maximum retry attempts (${currentJob.maxAttempts}). Last error: ${currentJob.lastError}`;
        await this.queueService.updateJob(currentJob);

        this.logger.error(
          `Screening job ${currentJob.id} exceeded maximum retry attempts (${currentJob.maxAttempts}); moved to dead-letter state (FAILED_PERMANENTLY)`,
          {
            jobId: currentJob.id,
            fingerprint: currentJob.fingerprint,
            attempts: currentJob.attemptCount,
            maxAttempts: currentJob.maxAttempts,
            lastError: currentJob.lastError,
          },
        );

        return currentJob;
      }

      // Schedule next retry with exponential backoff and jitter
      const delayMs = calculateBackoffWithJitter(
        currentJob.attemptCount,
        this.config.initialRetryDelayMs || 2000,
        this.config.maxRetryDelayMs || 60000,
        analysisResult.retryAfterMs,
      );

      currentJob.nextRetryAt = Date.now() + delayMs;
      currentJob.status = 'RETRY_WAIT';
      await this.queueService.updateJob(currentJob);

      this.logger.warn(
        `Screening job ${currentJob.id} encountered transient error; scheduled for retry #${currentJob.attemptCount + 1}`,
        {
          jobId: currentJob.id,
          fingerprint: currentJob.fingerprint,
          httpStatus: analysisResult.httpStatus,
          attempt: currentJob.attemptCount,
          maxAttempts: currentJob.maxAttempts,
          delayMs,
          nextRetryAt: new Date(currentJob.nextRetryAt).toISOString(),
          error: currentJob.lastError,
        },
      );

      return currentJob;
    } finally {
      await this.queueService.releaseJobLock(job.id, lock.lockToken);
    }
  }
}
