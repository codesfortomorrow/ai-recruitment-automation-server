import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BaseService } from '@Common';
import {
  googleSheetsConfigFactory,
  hrConfigFactory,
  mailConfigFactory,
} from '@Config';
import { RedisService } from '../redis';
import { GmailService } from '../mail/gmail.service';
import { MailService } from '../mail/mail.service';
import { HrAssignmentService } from './hr-assignment.service';
import { CandidateNotificationService } from './candidate-notification.service';
import { CandidateExcelService } from './candidate-excel.service';
import {
  GoogleSheetsService,
  GoogleSheetTrackerRow,
} from './google-sheets.service';
import { GoogleDriveService } from './google-drive.service';
import { GmailMessageDetail } from '../mail/gmail.types';
import { ResumeAnalysisResult } from '../mail/gemini.types';
import { ResumeFingerprintService } from '../mail/resume-fingerprint.service';
import { CandidateQueryDto } from './dto/candidate-query.dto';
import { UpdateCandidateTrackingDto } from './dto/update-candidate-tracking.dto';
import {
  CallAttemptRecord,
  CandidateStatsResponse,
  ExcelCandidateRecord,
} from './candidate.types';
import {
  CallOutcome,
  RecordCallAttemptDto,
} from './dto/record-call-attempt.dto';

export interface GoogleSheetsPollResult {
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  triggerSource: 'SCHEDULED' | 'MANUAL';
  totalRows: number;
  candidateRows: number;
  changedCandidatesCount: number;
  emailsTriggeredCount: number;
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
  details: Array<{
    candidateId: number;
    action: 'UNCHANGED' | 'RECONCILED' | 'SKIPPED_NOT_FOUND' | 'ERROR';
    qualifyingUnansweredCount?: number;
    emailTriggered?: boolean;
    error?: string;
  }>;
  message?: string;
}

@Injectable()
export class CandidateService extends BaseService {
  private isPollingGoogleSheets = false;
  private lastGoogleSheetsPollAt = 0;

  constructor(
    private readonly hrAssignmentService: HrAssignmentService,
    @Inject(forwardRef(() => CandidateNotificationService))
    private readonly notificationService: CandidateNotificationService,
    @Inject(forwardRef(() => CandidateExcelService))
    private readonly candidateExcelService: CandidateExcelService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => GmailService))
    private readonly gmailService: GmailService,
    @Inject(forwardRef(() => ResumeFingerprintService))
    private readonly resumeFingerprintService: ResumeFingerprintService,
    @Optional()
    @Inject(hrConfigFactory.KEY)
    private readonly hrConfig?: ConfigType<typeof hrConfigFactory>,
    @Optional()
    @Inject(forwardRef(() => MailService))
    private readonly mailService?: MailService,
    @Optional()
    @Inject(mailConfigFactory.KEY)
    private readonly mailConfig?: ConfigType<typeof mailConfigFactory>,
    @Optional()
    @Inject(googleSheetsConfigFactory.KEY)
    private readonly googleSheetsConfig?: ConfigType<
      typeof googleSheetsConfigFactory
    >,
    @Optional()
    private readonly googleDriveService?: GoogleDriveService,
  ) {
    super({ loggerDefaultMeta: { service: CandidateService.name } });
  }

  private inMemoryCandidateIdCounter = 20;

  /**
   * Concurrency-safe, persistent atomic candidate ID allocator.
   * Backed by Redis atomic sequence 'recruitment:candidate:id_sequence' and seeded cleanly
   * from Google Sheets and historical candidate records (baseline >= 20).
   * Monotonically increases without resetting or reusing IDs.
   */
  public async allocateNextCandidateId(): Promise<number> {
    const seqKey = 'recruitment:candidate:id_sequence';
    if (this.redisService?.client) {
      try {
        const exists = await this.redisService.client.exists(seqKey);
        if (!exists) {
          let highestKnownId = 20;

          // Check Google Sheets
          if (this.googleSheetsService?.isConfigured()) {
            try {
              const rows =
                await this.googleSheetsService.readCandidateTrackerRows();
              for (const row of rows) {
                if (row.candidateId > highestKnownId) {
                  highestKnownId = row.candidateId;
                }
              }
            } catch {}
          }

          // Check Redis processed candidates
          try {
            const processedKeys = await this.redisService.client.keys(
              'recruitment:candidate:processed:*',
            );
            for (const key of processedKeys) {
              const val = await this.redisService.client.get(key);
              if (val) {
                const parsed = parseInt(val, 10);
                if (!isNaN(parsed) && parsed > highestKnownId) {
                  highestKnownId = parsed;
                }
              }
            }
          } catch {}

          await this.redisService.client.set(
            seqKey,
            String(Math.max(highestKnownId, 20)),
            'NX',
          );
        }

        const nextId = await this.redisService.client.incr(seqKey);
        return nextId;
      } catch (err: any) {
        this.logger.warn(
          `Redis atomic candidate ID allocation failed: ${err.message}; using in-memory allocator`,
        );
      }
    }

    this.inMemoryCandidateIdCounter = Math.max(
      this.inMemoryCandidateIdCounter + 1,
      21,
    );
    return this.inMemoryCandidateIdCounter;
  }

  /**
   * Maps a GoogleSheetTrackerRow into an ExcelCandidateRecord format for backwards compatibility.
   */
  public mapGoogleSheetRowToCandidateRecord(
    row: GoogleSheetTrackerRow,
  ): ExcelCandidateRecord {
    const isShortlist =
      row.applicationStatus?.toUpperCase().includes('SHORTLIST') ||
      row.applicationStatus === 'New';

    const hr1Name = (this.hrConfig?.hr1?.name || 'Abhishek')
      .trim()
      .toLowerCase();
    const hr2Name = (this.hrConfig?.hr2?.name || 'Jayendra')
      .trim()
      .toLowerCase();
    const assignedName = (row.assignedHrName || '').trim().toLowerCase();

    let assignedHrId: string | undefined = (row as any).assignedHrId;
    let assignedHrEmail: string | undefined = (row as any).assignedHrEmail;

    if (!assignedHrEmail || !assignedHrId) {
      if (assignedName === hr1Name) {
        assignedHrId = this.hrConfig?.hr1?.id || 'hr-1';
        assignedHrEmail = this.hrConfig?.hr1?.email || undefined;
      } else if (assignedName === hr2Name) {
        assignedHrId = this.hrConfig?.hr2?.id || 'hr-2';
        assignedHrEmail = this.hrConfig?.hr2?.email || undefined;
      }
    }

    return {
      id: row.candidateId,
      name: row.candidateName,
      email: row.email,
      phone: row.phone,
      jobRole: row.jobRole,
      assignedHrName: row.assignedHrName,
      assignedHrId,
      assignedHrEmail,
      screeningStatus: isShortlist ? 'SHORTLIST' : row.applicationStatus,
      applicationStatus: row.applicationStatus,
      matchScore: null,
      summary: row.hrRemarks,
      hrRemarks: row.hrRemarks,
      cvLink: row.cvLink,
      driveFileId: row.driveFileId,
      experience: row.totalExperience,
      currentCompany: row.currentCompany,
      company: row.currentCompany,
      currentInterviewRound: row.currentInterviewRound,
      totalCallAttempts: row.totalCallAttempts,
      callCount: row.totalCallAttempts,
      call1Date: row.call1Date,
      call1Status: row.call1Status,
      call1Remarks: row.call1Remarks,
      call2Date: row.call2Date,
      call2Status: row.call2Status,
      call2Remarks: row.call2Remarks,
      call3Date: row.call3Date,
      call3Status: row.call3Status,
      call3Remarks: row.call3Remarks,
      nextFollowUpDate: row.nextFollowUpDate,
      automatedFollowUpEmailStatus: row.automatedFollowUpEmailStatus,
      followUpEmailSentAt: row.followUpEmailSentAt,
      lastUpdatedBy: row.lastUpdatedBy,
      lastUpdatedAt: row.lastUpdatedAt,
      callbackStatus: (() => {
        const hasAnswered =
          row.call1Status === 'Answered' ||
          row.call2Status === 'Answered' ||
          row.call3Status === 'Answered' ||
          row.currentInterviewRound === 'Completed';
        const isMissed =
          row.totalCallAttempts >= 3 &&
          !hasAnswered &&
          (row.call3Status === 'Not Answered' ||
            row.call3Status === 'Busy' ||
            row.call3Status === 'Switched Off' ||
            row.automatedFollowUpEmailStatus === 'SENT');
        if (hasAnswered) return 'Completed';
        if (isMissed) return 'Missed';
        return 'Pending';
      })(),
      callStatus: (() => {
        const hasAnswered =
          row.call1Status === 'Answered' ||
          row.call2Status === 'Answered' ||
          row.call3Status === 'Answered';
        if (hasAnswered) return 'Received';
        if (
          row.call1Status === 'Call Back Requested' ||
          row.call2Status === 'Call Back Requested'
        )
          return 'Returned';
        if (row.totalCallAttempts >= 3) return 'Not Applicable';
        return '';
      })(),
    };
  }

  /**
   * Dispatches email notification to assigned HR or manual review for a candidate.
   */
  public async dispatchNotification(
    candidate: any,
  ): Promise<{ sent: boolean; error?: string }> {
    const status = candidate.screeningStatus || candidate.applicationStatus;
    if (
      status === 'SHORTLIST' &&
      (candidate.assignedHrEmail ||
        (candidate.assignedHrName && candidate.assignedHrName !== 'Unassigned'))
    ) {
      try {
        await this.notificationService.notifyAssignedHr(candidate);
        return { sent: true };
      } catch (err: any) {
        return { sent: false, error: err.message };
      }
    } else if (status === 'MANUAL_REVIEW') {
      try {
        await this.notificationService.notifyManualReview(candidate);
        return { sent: true };
      } catch (err: any) {
        return { sent: false, error: err.message };
      }
    }
    return { sent: true };
  }

  /**
   * Persists screening result directly to the local Excel candidate database and triggers
   * automatic HR email notification if candidate is shortlisted.
   * Guarantees duplicate prevention via Redis idempotency key and normalized email.
   * PostgreSQL is not used for candidate storage.
   */
  async persistAndProcessScreeningResult(params: {
    messageDetail: GmailMessageDetail;
    analysisResult: ResumeAnalysisResult;
    candidateId?: number;
    forceUpdate?: boolean;
    driveFileId?: string;
    cvLink?: string;
  }): Promise<any | null> {
    const {
      messageDetail,
      analysisResult,
      candidateId: requestedCandidateId,
      forceUpdate,
      driveFileId: initialDriveFileId,
      cvLink: initialCvLink,
    } = params;

    if (analysisResult.status !== 'success' || !analysisResult.analysis) {
      this.logger.warn(
        'Cannot persist candidate: analysis result is unsuccessful or empty',
        { messageId: messageDetail.id, status: analysisResult.status },
      );
      return null;
    }

    const analysis = analysisResult.analysis;
    const attachmentId = analysisResult.attachmentId;

    // 1. Strict validation: candidate records must originate from a verified resume attachment
    if (
      !attachmentId ||
      typeof attachmentId !== 'string' ||
      attachmentId.trim().length === 0
    ) {
      this.logger.warn(
        'Skipping candidate persistence: Candidate record requires a valid, verified resume attachment ID',
        { messageId: messageDetail.id },
      );
      return null;
    }

    // 2. Validate attachment format and extraction status
    const attachmentMeta = messageDetail.attachments?.find(
      (a) => a.attachmentId === attachmentId,
    );
    const candidateFilename =
      attachmentMeta?.filename || analysisResult.filename || '';
    const lowerFilename = candidateFilename.toLowerCase();
    const isSupportedResumeFormat =
      lowerFilename.endsWith('.pdf') || lowerFilename.endsWith('.docx');

    if (!isSupportedResumeFormat) {
      this.logger.warn(
        `Skipping candidate persistence: attachment "${candidateFilename}" is not a supported resume format (PDF or DOCX)`,
        { messageId: messageDetail.id, attachmentId },
      );
      return null;
    }

    if (messageDetail.resumes && messageDetail.resumes.length > 0) {
      const resumeMeta = messageDetail.resumes.find(
        (r) => r.attachmentId === attachmentId,
      );
      if (
        resumeMeta &&
        resumeMeta.status !== 'success' &&
        analysis.rejectionReason !== 'RESUME_EXTRACTION_INSUFFICIENT'
      ) {
        this.logger.warn(
          `Skipping candidate persistence: resume extraction for attachment ${attachmentId} was not successful`,
          { messageId: messageDetail.id, status: resumeMeta.status },
        );
        return null;
      }
    }

    // Idempotency key is strictly attachment-based
    const idempotencyKey = `${messageDetail.id}:${attachmentId}`;
    const fingerprint = analysisResult.fingerprint;
    const lockToken = analysisResult.lockToken;

    const applicantEmail =
      analysis.candidate?.email || messageDetail.sender?.email;

    // 2b. Check if resume fingerprint was already processed for this applicant
    if (fingerprint && !forceUpdate && requestedCandidateId === undefined) {
      const isDuplicate =
        await this.resumeFingerprintService.isFingerprintProcessed(
          fingerprint,
          applicantEmail,
        );
      if (isDuplicate) {
        this.logger.info(
          `Duplicate resume skipped; fingerprint already processed`,
          {
            fingerprint,
            messageId: messageDetail.id,
            attachmentId,
          },
        );
        if (lockToken) {
          await this.resumeFingerprintService.releaseProcessingLock(
            fingerprint,
            lockToken,
          );
        }
        return null;
      }
    }

    // 3. Check if application was already processed in Redis
    if (!forceUpdate && requestedCandidateId === undefined) {
      try {
        const existingId = await this.redisService.client.get(
          `recruitment:candidate:processed:${idempotencyKey}`,
        );
        if (existingId) {
          this.logger.info(
            'Candidate application already processed, skipping duplicate processing',
            {
              candidateId: existingId,
              idempotencyKey,
            },
          );

          if (fingerprint && lockToken) {
            await this.resumeFingerprintService.releaseProcessingLock(
              fingerprint,
              lockToken,
            );
          }

          const existingCandidate =
            await this.candidateExcelService.getCandidateById(
              parseInt(existingId, 10),
            );

          // If Google Sheets sync previously failed for this candidate, retry it now without resending HR email
          if (existingCandidate) {
            if (this.googleSheetsService.isConfigured()) {
              try {
                const isPending = await this.redisService.client.sismember(
                  'recruitment:google-sheets:pending_retries',
                  String(existingId),
                );
                if (isPending) {
                  this.logger.info(
                    `Retrying pending Google Sheets sync for previously processed candidate ID ${existingId}`,
                  );
                  await this.retryCandidateSheetsSync(existingCandidate);
                }
              } catch (retryErr: any) {
                this.logger.warn('Failed to retry pending Google Sheets sync', {
                  candidateId: existingId,
                  cause: this.googleSheetsService.sanitizeError(retryErr),
                });
              }
            } else if (this.googleSheetsService.isRequired()) {
              this.logger.warn(
                `Google Sheets synchronization is required for candidate ID ${existingId} but currently unconfigured: ${this.googleSheetsService.getConfigurationIssue()}`,
                { candidateId: existingId },
              );
            }
          }

          return existingCandidate;
        }
      } catch (redisErr: any) {
        this.logger.warn('Redis check failed, proceeding to Excel storage', {
          cause: redisErr.message,
        });
      }
    }

    // 4. Map screening status first so evaluation results are available for HR assignment
    let screeningStatus: 'SHORTLIST' | 'REJECT' | 'MANUAL_REVIEW';
    switch (analysis.screeningStatus) {
      case 'SHORTLIST':
        screeningStatus = 'SHORTLIST';
        break;
      case 'REJECT':
        screeningStatus = 'REJECT';
        break;
      case 'MANUAL_REVIEW':
      default:
        screeningStatus = 'MANUAL_REVIEW';
        break;
    }

    // 5. Perform Role-Based HR Assignment with full screening score and status context
    const hrContext = {
      matchScore: analysis.matchScore,
      screeningStatus,
      hrReviewRequired: analysis.hrReviewRequired,
      missingRequirements: analysis.missingOrUnclearRequirements,
    };

    const rawRoleFromAnalysis =
      analysis.application?.jobRole ||
      (analysis as any).resolvedRole ||
      (analysis.suggestedProfile && analysis.suggestedProfile.length <= 50
        ? analysis.suggestedProfile
        : null);
    const rawRoleFromSubject = messageDetail.subject;

    let hrAssignment = this.hrAssignmentService.assignHr(
      rawRoleFromAnalysis,
      hrContext,
    );
    let appliedRole: string = rawRoleFromAnalysis || rawRoleFromSubject;

    if (!hrAssignment && rawRoleFromSubject) {
      const subjectAssignment = this.hrAssignmentService.assignHr(
        rawRoleFromSubject,
        hrContext,
      );
      if (subjectAssignment) {
        hrAssignment = subjectAssignment;
        appliedRole = rawRoleFromSubject;
      }
    }

    const normalizedRole = hrAssignment
      ? hrAssignment.canonicalRole
      : this.hrAssignmentService.normalizeJobRole(appliedRole);

    let assignedHrId = hrAssignment?.id || null;
    let assignedHrEmail = hrAssignment?.email || null;
    let assignedHrName = hrAssignment?.name || null;

    if (!hrAssignment) {
      const manualReviewEmail =
        this.hrConfig?.manualReviewEmail?.trim() || null;
      this.logger.info(
        `Role "${appliedRole}" is unknown or ambiguous; assignment routed to manual review (${manualReviewEmail || 'unconfigured'})`,
        { messageId: messageDetail.id },
      );
      assignedHrId = 'hr-manual-review';
      assignedHrEmail = manualReviewEmail;
      assignedHrName = 'Manual Review';
      // CORE REQUIREMENT: Unknown or ambiguous roles must ALWAYS preserve MANUAL_REVIEW
      // Do not automatically shortlist based only on a high score.
      screeningStatus = 'MANUAL_REVIEW';
    }

    const rejectionReason =
      screeningStatus === 'REJECT'
        ? analysis.screeningExplanation ||
          (analysis.missingOrUnclearRequirements.length > 0
            ? `Unmet mandatory criteria: ${analysis.missingOrUnclearRequirements.join('; ')}`
            : 'Candidate does not meet mandatory qualifications')
        : null;

    try {
      // 5b. Ensure original CV is stored in the central Google Drive folder "Central Repository of Resume" / role subfolder
      let driveFileId =
        initialDriveFileId ||
        (analysisResult as any).driveFileId ||
        messageDetail.resumes?.find((r) => r.attachmentId === attachmentId)
          ?.driveFileId;
      let cvLink =
        initialCvLink ||
        (analysisResult as any).cvLink ||
        messageDetail.resumes?.find((r) => r.attachmentId === attachmentId)
          ?.cvLink;

      if (driveFileId && !cvLink) {
        cvLink = `=HYPERLINK("https://drive.google.com/file/d/${driveFileId}/view", "View CV")`;
      }

      let driveUploadError: string | null = null;
      if (
        !driveFileId &&
        this.googleDriveService?.isConfigured() &&
        attachmentId
      ) {
        try {
          const buffer = await this.gmailService.downloadAttachment(
            messageDetail.id,
            attachmentId,
          );
          if (buffer && buffer.length > 0) {
            const driveUpload = await this.googleDriveService.uploadCv({
              buffer,
              filename: candidateFilename,
              mimeType: attachmentMeta?.mimeType,
              candidateEmail:
                analysis.candidate.email || messageDetail.sender?.email,
              candidateName:
                analysis.candidate.name || messageDetail.sender?.name,
              role: appliedRole,
              canonicalRole: hrAssignment?.canonicalRole || null,
            });
            driveFileId = driveUpload.fileId;
            cvLink = driveUpload.cvLink;
            await this.googleDriveService.markFileProcessed(driveUpload.fileId);
          }
        } catch (driveErr: any) {
          driveUploadError = driveErr.message;
          this.logger.warn(
            `Failed to upload candidate resume to Google Drive: ${driveErr.message}`,
            {
              messageId: messageDetail.id,
              attachmentId,
            },
          );
        }
      }

      // 6. Allocate concurrency-safe atomic candidate ID (Google Sheets is the primary store)
      // Ensure candidate record uses the canonical job role applied for, not a free-form narrative profile
      const finalRole =
        analysis.application?.jobRole ||
        appliedRole ||
        (analysis as any).resolvedRole ||
        (analysis.suggestedProfile && analysis.suggestedProfile.length <= 50
          ? analysis.suggestedProfile
          : normalizedRole);

      const targetCandidateId =
        requestedCandidateId !== undefined
          ? requestedCandidateId
          : await this.allocateNextCandidateId();

      const candidateRecord = {
        id: targetCandidateId,
        idempotencyKey,
        name: analysis.candidate.name || messageDetail.sender.name || null,
        email: analysis.candidate.email || messageDetail.sender.email || null,
        phone: analysis.candidate.phone || null,
        jobRole: finalRole,
        normalizedRole,
        skills: analysis.application.skills || [],
        education: (analysis.application.education as any) || [],
        experience: (analysis.application.experience as any) || [],
        projects: (analysis.application.projects as any) || [],
        summary: analysis.summary,
        matchScore: analysis.matchScore,
        matchedRequirements: analysis.matchedRequirements || [],
        missingRequirements: analysis.missingOrUnclearRequirements || [],
        screeningStatus,
        screeningExplanation: analysis.screeningExplanation,
        rejectionReason,
        assignedHrId,
        assignedHrEmail,
        assignedHrName,
        recommendation:
          analysis.recommendedStatus ||
          (analysis as any).recommendation ||
          screeningStatus,
        gmailMessageId: messageDetail.id,
        gmailThreadId: messageDetail.threadId || null,
        attachmentId,
        filename: attachmentMeta?.filename || analysisResult.filename || null,
        mimeType: attachmentMeta?.mimeType || null,
        attachmentSize: attachmentMeta?.size || null,
        analyzedAt: new Date(analysisResult.analyzedAt || Date.now()),
        cvLink,
        driveFileId,
      };

      // 7. Store attachment & idempotency metadata in Redis
      try {
        await this.redisService.client.set(
          `candidate:resume:${targetCandidateId}`,
          JSON.stringify({
            gmailMessageId: messageDetail.id,
            attachmentId,
            filename: candidateRecord.filename,
            mimeType: candidateRecord.mimeType,
            cvLink,
            driveFileId,
          }),
          'EX',
          86400 * 30, // 30 days
        );

        await this.redisService.client.set(
          `recruitment:candidate:processed:${idempotencyKey}`,
          String(targetCandidateId),
          'EX',
          86400 * 30,
        );
      } catch (redisErr: any) {
        this.logger.warn('Failed to cache candidate metadata in Redis', {
          cause: redisErr.message,
        });
      }

      this.logger.info(
        `Candidate ID ${targetCandidateId} (${candidateRecord.name || 'Unknown'}, Status: ${screeningStatus}, Role: ${candidateRecord.jobRole}) allocated. Persisting to Google Sheets...`,
      );

      let sheetsSaved = false;
      let sheetsError: string | null = null;

      // 7b. Save candidate record to Google Sheets (Permanent Candidate Store)
      if (this.googleSheetsService.isConfigured()) {
        try {
          const sheetsResult = await this.googleSheetsService.saveCandidate({
            id: targetCandidateId,
            name: candidateRecord.name,
            email: candidateRecord.email,
            phone: candidateRecord.phone,
            jobRole: candidateRecord.jobRole,
            assignedHrName: candidateRecord.assignedHrName,
            experience: candidateRecord.experience,
            company:
              (candidateRecord as any).company ||
              (typeof candidateRecord.experience?.[0] === 'object'
                ? (candidateRecord.experience[0] as any)?.company || null
                : null),
            screeningStatus,
            rejectionReason,
            hrRemarks: candidateRecord.summary,
            cvLink: candidateRecord.cvLink,
            driveFileId: candidateRecord.driveFileId,
          });

          sheetsSaved = true;
          this.logger.info(
            `Saved candidate ID ${targetCandidateId} (${candidateRecord.name || 'Unknown'}) to Google Sheets (${sheetsResult.action} row ${sheetsResult.rowNumber})`,
            {
              candidateId: targetCandidateId,
              action: sheetsResult.action,
              rowNumber: sheetsResult.rowNumber,
              updatedRange: sheetsResult.updatedRange,
            },
          );

          // Remove from pending retries set if it was previously failed
          try {
            await this.redisService.client.srem(
              'recruitment:google-sheets:pending_retries',
              String(targetCandidateId),
            );
          } catch {}
        } catch (sheetsErr: any) {
          const sanitized = this.googleSheetsService.sanitizeError(sheetsErr);
          sheetsError = sanitized;
          this.logger.error(
            `Failed to save candidate ID ${targetCandidateId} to Google Sheets: ${sanitized}. Job queued for retry.`,
            { candidateId: targetCandidateId, cause: sanitized },
          );

          try {
            await this.redisService.client.sadd(
              'recruitment:google-sheets:pending_retries',
              String(targetCandidateId),
            );
          } catch {}
        }
      } else {
        const issue = this.googleSheetsService.getConfigurationIssue();
        sheetsError = issue;
        if (this.googleSheetsService.isRequired()) {
          this.logger.error(
            `Google Sheets synchronization is required but cannot proceed for candidate ID ${targetCandidateId}: ${issue}. Queued in pending retries.`,
            { candidateId: targetCandidateId, issue },
          );
          try {
            await this.redisService.client.sadd(
              'recruitment:google-sheets:pending_retries',
              String(targetCandidateId),
            );
          } catch {}
        } else {
          this.logger.warn(
            `Google Sheets is not configured (${issue}); skipping Google Sheets save for candidate ID ${targetCandidateId}`,
          );
        }
      }

      let notificationSent = false;
      let notificationError: string | null = null;

      // 8. Automatic Email Notifications (HR Shortlist and Manual Review)
      // Dispatched ONLY after Google Sheets save succeeds (Sheets-first completion)
      if (sheetsSaved) {
        if (
          screeningStatus === 'SHORTLIST' &&
          (assignedHrEmail ||
            (assignedHrName && assignedHrName !== 'Unassigned'))
        ) {
          try {
            await this.notificationService.notifyAssignedHr(candidateRecord);
            notificationSent = true;
          } catch (notifErr: any) {
            notificationError = notifErr.message;
            this.logger.error(
              `HR email notification failed for candidate ID ${targetCandidateId}: ${notifErr.message}`,
              { candidateId: targetCandidateId, cause: notifErr.message },
            );
          }
        } else if (screeningStatus === 'MANUAL_REVIEW') {
          try {
            await this.notificationService.notifyManualReview(candidateRecord);
            notificationSent = true;
          } catch (notifErr: any) {
            notificationError = notifErr.message;
            this.logger.error(
              `Manual review email notification failed for candidate ID ${targetCandidateId}: ${notifErr.message}`,
              { candidateId: targetCandidateId, cause: notifErr.message },
            );
          }
        } else {
          notificationSent = true; // Not required for this screening status
        }
      }

      // 9. Mark resume fingerprint as processed and release processing lock (if sheetsSaved)
      if (fingerprint && sheetsSaved) {
        try {
          await this.resumeFingerprintService.markFingerprintProcessed(
            fingerprint,
            {
              candidateId: targetCandidateId,
              gmailMessageId: messageDetail.id,
              attachmentId,
              filename: candidateFilename,
              senderEmail: candidateRecord.email || messageDetail.sender?.email,
              processedAt: new Date().toISOString(),
              status: notificationSent ? 'COMPLETED' : 'PROCESSING',
            },
          );
        } catch (fpErr: any) {
          this.logger.warn('Failed to mark resume fingerprint as processed', {
            fingerprint,
            cause: fpErr.message,
          });
        }
      }

      if (fingerprint && lockToken) {
        try {
          await this.resumeFingerprintService.releaseProcessingLock(
            fingerprint,
            lockToken,
          );
        } catch {}
      }

      return {
        ...candidateRecord,
        sheetsSaved,
        sheetsError,
        notificationSent,
        notificationError,
        driveSaved: Boolean(driveFileId),
        driveError: driveUploadError,
      };
    } catch (err: any) {
      if (fingerprint && lockToken) {
        try {
          await this.resumeFingerprintService.releaseProcessingLock(
            fingerprint,
            lockToken,
          );
        } catch {}
      }
      throw err;
    }
  }

  /**
   * Retries syncing an existing candidate to Google Sheets without re-triggering HR email notification.
   */
  public async retryCandidateSheetsSync(candidate: any): Promise<boolean> {
    if (!this.googleSheetsService.isConfigured()) {
      if (this.googleSheetsService.isRequired()) {
        const issue = this.googleSheetsService.getConfigurationIssue();
        this.logger.error(
          `Cannot retry Google Sheets sync for candidate ID ${candidate.id}: Google Sheets is required but not configured (${issue}).`,
          { candidateId: candidate.id, issue },
        );
      }
      return false;
    }
    try {
      const sheetsResult = await this.googleSheetsService.saveCandidate({
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        phone: candidate.phone,
        jobRole: candidate.jobRole,
        assignedHrName: candidate.assignedHrName,
        experience: candidate.experience,
        company: candidate.company || candidate.currentCompany,
        screeningStatus: candidate.screeningStatus,
        rejectionReason: candidate.rejectionReason,
        hrRemarks: candidate.hrRemarks || candidate.summary,
        currentInterviewRound: candidate.currentInterviewRound,
        callCount: candidate.callCount,
        lastCallStatus: candidate.lastCallStatus,
        lastContactDate: candidate.lastContactDate,
        nextFollowUpDate: candidate.nextFollowUpDate,
        cvLink: candidate.cvLink,
        driveFileId: candidate.driveFileId,
      });

      await this.redisService.client.srem(
        'recruitment:google-sheets:pending_retries',
        String(candidate.id),
      );
      this.logger.info(
        `Successfully retried Google Sheets sync for candidate ID ${candidate.id} (${sheetsResult.action} row ${sheetsResult.rowNumber})`,
        {
          candidateId: candidate.id,
          action: sheetsResult.action,
          rowNumber: sheetsResult.rowNumber,
          updatedRange: sheetsResult.updatedRange,
        },
      );
      return true;
    } catch (err: any) {
      this.logger.error(
        `Retry Google Sheets sync failed for candidate ID ${candidate.id}`,
        { cause: this.googleSheetsService.sanitizeError(err) },
      );
      return false;
    }
  }

  /**
   * Retries syncing all pending candidates recorded in recruitment:google-sheets:pending_retries.
   */
  public async retryAllPendingSheetsSync(): Promise<{
    succeeded: number;
    failed: number;
  }> {
    let succeeded = 0;
    let failed = 0;
    if (
      !this.redisService?.client ||
      !this.googleSheetsService.isConfigured()
    ) {
      return { succeeded, failed };
    }
    try {
      const pendingIds = await this.redisService.client.smembers(
        'recruitment:google-sheets:pending_retries',
      );
      for (const idStr of pendingIds) {
        const id = parseInt(idStr, 10);
        if (isNaN(id)) continue;
        const candidate = await this.candidateExcelService.getCandidateById(id);
        if (!candidate) {
          await this.redisService.client.srem(
            'recruitment:google-sheets:pending_retries',
            idStr,
          );
          continue;
        }
        const success = await this.retryCandidateSheetsSync(candidate);
        if (success) succeeded++;
        else failed++;
      }
    } catch (err: any) {
      this.logger.error('Failed to retry pending Google Sheets syncs', {
        cause: this.googleSheetsService.sanitizeError(err),
      });
    }
    return { succeeded, failed };
  }

  /**
   * Retrieves pending Google Sheets candidate synchronizations and configuration status.
   */
  public async getPendingSheetsSyncCandidates(): Promise<{
    count: number;
    pendingIds: number[];
    isConfigured: boolean;
    isRequired: boolean;
    configurationIssue: string | null;
  }> {
    const isConfigured = this.googleSheetsService.isConfigured();
    const isRequired = this.googleSheetsService.isRequired();
    const configurationIssue = this.googleSheetsService.getConfigurationIssue();

    if (!this.redisService?.client) {
      return {
        count: 0,
        pendingIds: [],
        isConfigured,
        isRequired,
        configurationIssue,
      };
    }

    try {
      const pendingIdsStr = await this.redisService.client.smembers(
        'recruitment:google-sheets:pending_retries',
      );
      const pendingIds = pendingIdsStr
        .map((s) => parseInt(s, 10))
        .filter((n) => !isNaN(n))
        .sort((a, b) => a - b);

      return {
        count: pendingIds.length,
        pendingIds,
        isConfigured,
        isRequired,
        configurationIssue,
      };
    } catch {
      return {
        count: 0,
        pendingIds: [],
        isConfigured,
        isRequired,
        configurationIssue,
      };
    }
  }

  /**
   * Retrieves the operational status of the Google Sheets integration.
   */
  public getGoogleSheetsStatus(): {
    configured: boolean;
    required: boolean;
    spreadsheetId: string | null;
    worksheet: string;
    configurationIssue: string | null;
  } {
    return {
      configured: this.googleSheetsService.isConfigured(),
      required: this.googleSheetsService.isRequired(),
      spreadsheetId: this.googleSheetsService.getSpreadsheetId(),
      worksheet: 'Candidate Tracker',
      configurationIssue: this.googleSheetsService.getConfigurationIssue(),
    };
  }

  /**
   * Retrieves dashboard statistics directly from Google Sheets (or local historical backup).
   */
  async getDashboardStats(): Promise<CandidateStatsResponse> {
    if (this.googleSheetsService?.isConfigured()) {
      try {
        const rows = await this.googleSheetsService.readCandidateTrackerRows();
        if (rows && rows.length > 0) {
          let shortlisted = 0;
          let rejected = 0;
          let manualReview = 0;
          let pending = 0;
          let assignedToHr1 = 0;
          let assignedToHr2 = 0;
          let unassigned = 0;

          const hr1Name = (this.hrConfig?.hr1?.name || '').trim().toLowerCase();
          const hr2Name = (this.hrConfig?.hr2?.name || '').trim().toLowerCase();
          const roleCounts = new Map<string, number>();

          for (const row of rows) {
            const statusUpper = (row.applicationStatus || '').toUpperCase();
            if (statusUpper.includes('SHORTLIST')) {
              shortlisted++;
            } else if (statusUpper.includes('REJECT')) {
              rejected++;
            } else if (
              statusUpper.includes('MANUAL') ||
              statusUpper.includes('HOLD')
            ) {
              manualReview++;
            } else {
              pending++;
            }

            const assignedName = (row.assignedHrName || '')
              .trim()
              .toLowerCase();
            if (hr1Name && assignedName === hr1Name) {
              assignedToHr1++;
            } else if (hr2Name && assignedName === hr2Name) {
              assignedToHr2++;
            } else {
              unassigned++;
            }

            const role = row.jobRole || 'Unspecified';
            roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
          }

          const total = rows.length;
          const roleBreakdown = Array.from(roleCounts.entries()).map(
            ([role, count]) => ({ role, count }),
          );

          return {
            total,
            totalCandidates: total,
            shortlisted,
            rejected,
            manualReview,
            pending,
            assignedToHr1,
            assignedToHr2,
            unassigned,
            roleBreakdown,
          };
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to read stats from Google Sheets: ${err.message}`,
        );
      }
    }
    return await this.candidateExcelService.getDashboardStats();
  }

  /**
   * Retrieves paginated list of candidates from Google Sheets (or local historical backup) with filtering and search.
   */
  async findCandidates(query: CandidateQueryDto) {
    if (this.googleSheetsService?.isConfigured()) {
      try {
        const rows = await this.googleSheetsService.readCandidateTrackerRows();
        if (rows && rows.length > 0) {
          let records = rows.map((r) =>
            this.mapGoogleSheetRowToCandidateRecord(r),
          );

          if (query.role) {
            const rLower = query.role.toLowerCase();
            records = records.filter((c) =>
              (c.jobRole || c.normalizedRole || '')
                .toLowerCase()
                .includes(rLower),
            );
          }
          if (query.status) {
            const sLower = query.status.toLowerCase();
            records = records.filter((c) =>
              (c.screeningStatus || c.applicationStatus || '')
                .toLowerCase()
                .includes(sLower),
            );
          }
          if (query.assignedHr) {
            const hrLower = query.assignedHr.toLowerCase();
            records = records.filter((c) =>
              (c.assignedHrName || '').toLowerCase().includes(hrLower),
            );
          }
          if (query.search) {
            const qLower = query.search.toLowerCase();
            records = records.filter(
              (c) =>
                (c.name || '').toLowerCase().includes(qLower) ||
                (c.email || '').toLowerCase().includes(qLower) ||
                (c.phone || '').toLowerCase().includes(qLower) ||
                (c.jobRole || '').toLowerCase().includes(qLower),
            );
          }

          const total = records.length;
          const anyQuery = query as any;
          const limit = Math.max(
            1,
            Math.min(100, Number(anyQuery.limit || anyQuery.take) || 20),
          );
          const skip = Number(anyQuery.skip) || 0;
          const page = anyQuery.page
            ? Math.max(1, Number(anyQuery.page))
            : Math.floor(skip / limit) + 1;
          const candidates = records.slice(skip, skip + limit);

          return {
            candidates,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          };
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to find candidates from Google Sheets: ${err.message}`,
        );
      }
    }
    return await this.candidateExcelService.findCandidates(query);
  }

  async getCandidateById(id: number) {
    if (!id || isNaN(id)) {
      throw new BadRequestException('Invalid candidate ID');
    }

    if (this.googleSheetsService?.isConfigured()) {
      try {
        const sheetCandidate =
          await this.googleSheetsService.findCandidateById(id);
        if (sheetCandidate) {
          return this.mapGoogleSheetRowToCandidateRecord(sheetCandidate);
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to fetch candidate ${id} from Google Sheets: ${err.message}`,
        );
      }
    }

    const candidate = await this.candidateExcelService.getCandidateById(id);

    if (!candidate) {
      throw new NotFoundException(`Candidate with ID ${id} not found`);
    }

    return candidate;
  }

  /**
   * Retrieves original resume binary buffer from Gmail using cached attachment references.
   */
  async getResumeAttachment(candidateId: number): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
  }> {
    let meta: {
      gmailMessageId: string;
      attachmentId: string;
      filename?: string;
      mimeType?: string;
    } | null = null;

    try {
      const raw = await this.redisService.client.get(
        `candidate:resume:${candidateId}`,
      );
      if (raw) {
        meta = JSON.parse(raw);
      }
    } catch {}

    if (!meta || !meta.gmailMessageId || !meta.attachmentId) {
      const candidate = await this.getCandidateById(candidateId);
      throw new NotFoundException(
        `Resume attachment reference is not cached for candidate ID ${candidateId} (${candidate.name || 'Candidate'})`,
      );
    }

    try {
      const buffer = await this.gmailService.downloadAttachment(
        meta.gmailMessageId,
        meta.attachmentId,
      );

      const filename = meta.filename || 'resume.pdf';
      const mimeType =
        meta.mimeType ||
        (filename.toLowerCase().endsWith('.docx')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/pdf');

      return {
        buffer,
        filename,
        mimeType,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to retrieve resume buffer for candidate ID ${candidateId}`,
        { cause: err.message },
      );
      throw new NotFoundException(
        `Unable to download resume attachment: ${err.message}`,
      );
    }
  }

  /**
   * Validates standard email address format.
   */
  public isValidEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  /**
   * Formats server timestamp in IST (Asia/Kolkata) for human readability.
   */
  public formatServerDate(date: Date = new Date()): string {
    const validDate = date && !isNaN(date.getTime()) ? date : new Date();
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(validDate)
      .replace(',', '');
  }

  /**
   * Helper to format timestamps into clean, human-readable date and time (YYYY-MM-DD HH:mm:ss in IST).
   * Prevents raw ISO strings from cluttering spreadsheet cells.
   */
  public formatHumanReadableDate(
    dateInput?: Date | string | number | null,
  ): string {
    if (!dateInput) return '';
    const trimmed =
      typeof dateInput === 'string' ? dateInput.trim() : dateInput;
    if (!trimmed) return '';

    if (
      typeof trimmed === 'string' &&
      /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(trimmed)
    ) {
      return trimmed;
    }

    const d =
      typeof trimmed === 'string' || typeof trimmed === 'number'
        ? new Date(trimmed)
        : trimmed;
    if (!(d instanceof Date) || isNaN(d.getTime())) {
      return String(trimmed);
    }

    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      return formatter.format(d).replace(',', '').trim();
    } catch {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    }
  }

  /**
   * Checks if candidate has replied or exited the automated follow-up workflow.
   */
  public async hasCandidateReplied(candidateId: number): Promise<boolean> {
    if (!this.redisService?.client) return false;
    try {
      const replied = await this.redisService.client.get(
        `candidate:replied:${candidateId}`,
      );
      return replied === 'TRUE' || replied === '1';
    } catch {
      return false;
    }
  }

  /**
   * Marks that a candidate has replied to communications, which exits the automated follow-up workflow.
   */
  public async markCandidateReplied(candidateId: number): Promise<{
    candidateId: number;
    replied: boolean;
  }> {
    const candidate = await this.getCandidateById(candidateId);
    if (this.redisService?.client) {
      await this.redisService.client.set(
        `candidate:replied:${candidateId}`,
        'TRUE',
        'EX',
        86400 * 90,
      );
    }

    if (this.googleSheetsService.isConfigured()) {
      try {
        await this.googleSheetsService.saveCandidate({
          id: candidate.id,
          screeningStatus: candidate.screeningStatus,
          applicationStatus: 'Replied',
          hrRemarks: candidate.hrRemarks
            ? `${candidate.hrRemarks} | [Candidate Replied]`
            : '[Candidate Replied]',
        });
      } catch {}
    }

    this.logger.info(
      `Candidate ID ${candidateId} marked as replied; exited follow-up workflow`,
    );
    return { candidateId, replied: true };
  }

  /**
   * Retrieves full persistent call attempt history and escalation status for a candidate.
   */
  public async getCallAttempts(candidateId: number): Promise<{
    candidateId: number;
    candidateName: string;
    jobRole: string;
    assignedHrName: string;
    totalCallAttempts: number;
    qualifyingUnansweredCount: number;
    lastCallStatus: string;
    call1Date: string | null;
    call1Status: string | null;
    call1Remarks: string | null;
    call2Date: string | null;
    call2Status: string | null;
    call2Remarks: string | null;
    call3Date: string | null;
    call3Status: string | null;
    call3Remarks: string | null;
    call1DateAndStatus: string | null;
    call2DateAndStatus: string | null;
    call3DateAndStatus: string | null;
    lastCallDate: string | null;
    nextFollowUpDate: string | null;
    automatedFollowUpEmailStatus: string;
    followUpEmailSentAt: string | null;
    attempts: CallAttemptRecord[];
  }> {
    const candidate = await this.getCandidateById(candidateId);
    let attempts: CallAttemptRecord[] = [];
    if (this.redisService?.client) {
      try {
        const raw = await this.redisService.client.get(
          `recruitment:candidate:calls:${candidateId}`,
        );
        if (raw) {
          attempts = JSON.parse(raw);
        }
      } catch {}
    }

    const QUALIFYING_UNANSWERED_STATUSES = [
      'Not Answered',
      'Busy',
      'Switched Off',
    ];

    if (attempts.length === 0) {
      if (candidate.call1Status || candidate.call1Date) {
        attempts.push({
          attemptNumber: 1,
          callDate: candidate.call1Date || '',
          formattedCallDate: candidate.call1Date || '',
          status: (candidate.call1Status as CallOutcome) || 'Not Answered',
          notes: candidate.call1Remarks || undefined,
          isQualifyingUnanswered: QUALIFYING_UNANSWERED_STATUSES.includes(
            candidate.call1Status || '',
          ),
        });
      }
      if (candidate.call2Status || candidate.call2Date) {
        attempts.push({
          attemptNumber: 2,
          callDate: candidate.call2Date || '',
          formattedCallDate: candidate.call2Date || '',
          status: (candidate.call2Status as CallOutcome) || 'Not Answered',
          notes: candidate.call2Remarks || undefined,
          isQualifyingUnanswered: QUALIFYING_UNANSWERED_STATUSES.includes(
            candidate.call2Status || '',
          ),
        });
      }
      if (candidate.call3Status || candidate.call3Date) {
        attempts.push({
          attemptNumber: 3,
          callDate: candidate.call3Date || '',
          formattedCallDate: candidate.call3Date || '',
          status: (candidate.call3Status as CallOutcome) || 'Not Answered',
          notes: candidate.call3Remarks || undefined,
          isQualifyingUnanswered: QUALIFYING_UNANSWERED_STATUSES.includes(
            candidate.call3Status || '',
          ),
        });
      }
    } else {
      attempts.forEach((a) => {
        a.isQualifyingUnanswered = QUALIFYING_UNANSWERED_STATUSES.includes(
          a.status,
        );
      });
    }

    const qualifyingUnansweredCount = attempts.filter(
      (a) => a.isQualifyingUnanswered,
    ).length;

    const att1 = attempts.find((a) => a.attemptNumber === 1) || attempts[0];
    const att2 = attempts.find((a) => a.attemptNumber === 2) || attempts[1];
    const att3 = attempts.find((a) => a.attemptNumber === 3) || attempts[2];

    const call1Date = att1
      ? att1.formattedCallDate || att1.callDate
      : candidate.call1Date || null;
    const call1Status = att1 ? att1.status : candidate.call1Status || null;
    const call1Remarks = att1
      ? att1.notes || null
      : candidate.call1Remarks || null;

    const call2Date = att2
      ? att2.formattedCallDate || att2.callDate
      : candidate.call2Date || null;
    const call2Status = att2 ? att2.status : candidate.call2Status || null;
    const call2Remarks = att2
      ? att2.notes || null
      : candidate.call2Remarks || null;

    const call3Date = att3
      ? att3.formattedCallDate || att3.callDate
      : candidate.call3Date || null;
    const call3Status = att3 ? att3.status : candidate.call3Status || null;
    const call3Remarks = att3
      ? att3.notes || null
      : candidate.call3Remarks || null;

    return {
      candidateId: candidate.id,
      candidateName: candidate.name,
      jobRole: candidate.jobRole,
      assignedHrName: candidate.assignedHrName,
      totalCallAttempts:
        attempts.length ||
        candidate.totalCallAttempts ||
        candidate.callCount ||
        0,
      qualifyingUnansweredCount,
      lastCallStatus:
        attempts.length > 0
          ? attempts[attempts.length - 1].status
          : candidate.lastCallStatus || 'Not Called',
      call1Date,
      call1Status,
      call1Remarks,
      call2Date,
      call2Status,
      call2Remarks,
      call3Date,
      call3Status,
      call3Remarks,
      call1DateAndStatus:
        call1Date && call1Status
          ? `${call1Date} - ${call1Status}`
          : candidate.call1DateAndStatus || null,
      call2DateAndStatus:
        call2Date && call2Status
          ? `${call2Date} - ${call2Status}`
          : candidate.call2DateAndStatus || null,
      call3DateAndStatus:
        call3Date && call3Status
          ? `${call3Date} - ${call3Status}`
          : candidate.call3DateAndStatus || null,
      lastCallDate:
        attempts.length > 0
          ? attempts[attempts.length - 1].formattedCallDate ||
            attempts[attempts.length - 1].callDate
          : candidate.lastCallDate || candidate.lastContactDate || null,
      nextFollowUpDate:
        attempts.length > 0 && attempts[attempts.length - 1].nextFollowUpDate
          ? attempts[attempts.length - 1].nextFollowUpDate!
          : candidate.nextFollowUpDate || null,
      automatedFollowUpEmailStatus:
        candidate.automatedFollowUpEmailStatus || 'NOT_SENT',
      followUpEmailSentAt: candidate.followUpEmailSentAt || null,
      attempts,
    };
  }

  /**
   * Automatically dispatches a professional follow-up email upon the 3rd qualifying unanswered call attempt.
   * Enforces pre-send verification: exactly 3 qualifying attempts, candidate has not replied or exited,
   * follow-up not already sent, valid candidate email.
   * Guarantees at-most-once delivery via Redis distributed lock and persistent idempotency flag.
   */
  public async sendAutomatedFollowUpEmail(
    candidate: ExcelCandidateRecord,
    attempts: CallAttemptRecord[],
  ): Promise<{
    sent: boolean;
    reason?: string;
    error?: string;
  }> {
    const qualifyingCount = attempts.filter(
      (a) => a.isQualifyingUnanswered,
    ).length;

    // 1. Verify qualifying count threshold
    if (qualifyingCount < 3) {
      return {
        sent: false,
        reason: `Only ${qualifyingCount} qualifying unanswered attempts exist; threshold is 3`,
      };
    }

    // 2. Verify candidate has not replied or exited workflow
    const hasReplied = await this.hasCandidateReplied(candidate.id);
    const statusUpper = String(
      candidate.applicationStatus || candidate.screeningStatus || '',
    ).toUpperCase();
    const isExited = [
      'REJECT',
      'REJECTED',
      'SELECTED',
      'HIRED',
      'WITHDRAWN',
      'REPLIED',
    ].includes(statusUpper);

    if (hasReplied || isExited) {
      this.logger.info(
        `Skipping automated follow-up email for candidate ID ${candidate.id}: candidate has replied or exited workflow (Status: ${statusUpper})`,
      );
      return {
        sent: false,
        reason: 'Candidate has replied or exited follow-up workflow',
      };
    }

    // 3. Verify email has not already been sent (persistent idempotency)
    let alreadySent = candidate.automatedFollowUpEmailStatus === 'SENT';
    if (!alreadySent && this.redisService?.client) {
      try {
        const cached = await this.redisService.client.get(
          `candidate:followup_sent:${candidate.id}`,
        );
        alreadySent = cached === 'SENT';
      } catch {}
    }

    if (alreadySent) {
      this.logger.info(
        `Skipping automated follow-up email for candidate ID ${candidate.id}: email already sent previously`,
      );
      return {
        sent: false,
        reason: 'Automated follow-up email already sent',
      };
    }

    // 4. Verify candidate has valid email address
    if (!this.isValidEmail(candidate.email)) {
      this.logger.warn(
        `Cannot send automated follow-up email for candidate ID ${candidate.id}: invalid email "${candidate.email}"`,
      );
      return {
        sent: false,
        reason: 'Invalid candidate email address',
      };
    }

    // 5. Distributed lock for at-most-once concurrency guarantee
    const lockKey = `lock:call-followup-email:${candidate.id}`;
    const lockToken = crypto.randomUUID();
    let lockAcquired = false;

    if (this.redisService?.client) {
      try {
        const res = await this.redisService.client.set(
          lockKey,
          lockToken,
          'EX',
          60,
          'NX',
        );
        lockAcquired = res === 'OK';
      } catch {
        lockAcquired = true; // Fallback if Redis is unavailable
      }
    } else {
      lockAcquired = true;
    }

    if (!lockAcquired) {
      this.logger.warn(
        `Concurrent automated follow-up email dispatch locked for candidate ID ${candidate.id}`,
      );
      return {
        sent: false,
        reason: 'Concurrent dispatch in progress; locked',
      };
    }

    try {
      // Re-verify after acquiring lock
      if (this.redisService?.client) {
        const recheck = await this.redisService.client.get(
          `candidate:followup_sent:${candidate.id}`,
        );
        if (recheck === 'SENT') {
          return { sent: false, reason: 'Already sent (verified under lock)' };
        }
      }

      const candidateName = candidate.name || 'Candidate';
      const jobRole = candidate.jobRole || 'the applied';

      const emailSubject = `Following up on your application for ${jobRole} - Codes for Tomorrow`;

      const emailText = `Dear ${candidateName},

Greetings from Codes for Tomorrow!

We have been trying to reach you regarding your application for the ${jobRole} position but have been unable to connect with you.

We understand that you may have a busy schedule. If you are still interested in this opportunity, please reply to this email with a convenient time for us to connect.

We would be happy to discuss your application and the next steps in the recruitment process.

If you are no longer interested, please let us know so that we can update our records accordingly.

We look forward to hearing from you.

Best regards,  
HR Team  
Codes for Tomorrow`;

      const emailHtml = `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333333; max-width: 600px;">
  <p>Dear ${candidateName},</p>
  <p>Greetings from Codes for Tomorrow!</p>
  <p>We have been trying to reach you regarding your application for the <strong>${jobRole}</strong> position but have been unable to connect with you.</p>
  <p>We understand that you may have a busy schedule. If you are still interested in this opportunity, please reply to this email with a convenient time for us to connect.</p>
  <p>We would be happy to discuss your application and the next steps in the recruitment process.</p>
  <p>If you are no longer interested, please let us know so that we can update our records accordingly.</p>
  <p>We look forward to hearing from you.</p>
  <p style="margin-top: 24px;">Best regards,<br/><strong>HR Team</strong><br/>Codes for Tomorrow</p>
</div>`;

      this.logger.info(
        `Sending automated 3rd unanswered call follow-up email to ${candidate.email} for candidate ID ${candidate.id}`,
      );

      const sendResult = await this.gmailService.sendEmail({
        to: candidate.email,
        subject: emailSubject,
        bodyText: emailText,
        bodyHtml: emailHtml,
      });

      if (sendResult.status === 'SENT') {
        if (this.redisService?.client) {
          try {
            await this.redisService.client.set(
              `candidate:followup_sent:${candidate.id}`,
              'SENT',
              'EX',
              86400 * 90,
            );
          } catch {}
        }

        return { sent: true };
      } else {
        return {
          sent: false,
          error: sendResult.error || 'Email dispatch failed',
        };
      }
    } finally {
      if (this.redisService?.client && lockAcquired) {
        try {
          const luaRelease = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          await this.redisService.client.eval(
            luaRelease,
            1,
            lockKey,
            lockToken,
          );
        } catch {}
      }
    }
  }

  /**
   * Records an HR call attempt for a candidate, manages persistent attempt history,
   * counts qualifying unanswered attempts, synchronizes Excel and Google Sheets, and triggers
   * the automated follow-up email upon the 3rd qualifying unanswered call attempt.
   */
  public async recordCallAttempt(
    candidateId: number,
    dto: RecordCallAttemptDto,
    user?: any,
  ): Promise<{
    success: boolean;
    candidateId: number;
    callAttempt: CallAttemptRecord;
    totalCallAttempts: number;
    qualifyingUnansweredCount: number;
    lastCallStatus: CallOutcome;
    call1Date: string | null;
    call1Status: string | null;
    call1Remarks: string | null;
    call2Date: string | null;
    call2Status: string | null;
    call2Remarks: string | null;
    call3Date: string | null;
    call3Status: string | null;
    call3Remarks: string | null;
    call1DateAndStatus: string | null;
    call2DateAndStatus: string | null;
    call3DateAndStatus: string | null;
    lastCallDate: string;
    nextFollowUpDate: string | null;
    automatedFollowUpEmailStatus: string;
    followUpEmailSentAt: string | null;
    emailTriggered: boolean;
    emailResult?: any;
    sheetsSyncResult?: any;
  }> {
    if (!candidateId || isNaN(candidateId)) {
      throw new BadRequestException('Invalid candidate ID');
    }

    const candidate = await this.getCandidateById(candidateId);

    // 1. HR Authorization Check (Requirement 4)
    // HR1 and HR2 must be able to track their respective candidates without modifying another candidate's record
    const hr1Id = this.hrConfig?.hr1?.id || 'hr-1';
    const hr1Email = (this.hrConfig?.hr1?.email || '').toLowerCase();
    const hr2Id = this.hrConfig?.hr2?.id || 'hr-2';
    const hr2Email = (this.hrConfig?.hr2?.email || '').toLowerCase();

    const callerHrId = dto.callerHrId || (user && user.hrId) || null;
    const callerHrEmail = (
      dto.callerHrEmail ||
      (user && user.email) ||
      ''
    ).toLowerCase();
    const candidateAssignedEmail = (
      candidate.assignedHrEmail || ''
    ).toLowerCase();

    const isCallerHr1 =
      (callerHrId && callerHrId === hr1Id) ||
      (callerHrEmail && callerHrEmail === hr1Email);
    const isCallerHr2 =
      (callerHrId && callerHrId === hr2Id) ||
      (callerHrEmail && callerHrEmail === hr2Email);

    if (
      isCallerHr1 &&
      candidateAssignedEmail &&
      candidateAssignedEmail === hr2Email
    ) {
      throw new ForbiddenException(
        'HR1 is not authorized to modify call records for candidates assigned to HR2',
      );
    }

    if (
      isCallerHr2 &&
      candidateAssignedEmail &&
      candidateAssignedEmail === hr1Email
    ) {
      throw new ForbiddenException(
        'HR2 is not authorized to modify call records for candidates assigned to HR1',
      );
    }

    // 2. Server timestamp & timezone (IST Asia/Kolkata)
    const now = new Date();
    const isoDate = now.toISOString();
    const formattedDate = this.formatServerDate(now);

    // 3. Outcome rules (Requirement 3)
    // Qualifying unanswered outcomes: Not Answered, Busy, Switched Off
    // Non-qualifying outcomes: Answered, Call Back Requested, Invalid Number
    const QUALIFYING_UNANSWERED_STATUSES = [
      'Not Answered',
      'Busy',
      'Switched Off',
    ];
    const isQualifyingUnanswered = QUALIFYING_UNANSWERED_STATUSES.includes(
      dto.status,
    );

    // 4. Retrieve persistent call history from Redis (Requirement 6)
    let attempts: CallAttemptRecord[] = [];
    if (this.redisService?.client) {
      try {
        const raw = await this.redisService.client.get(
          `recruitment:candidate:calls:${candidateId}`,
        );
        if (raw) {
          attempts = JSON.parse(raw);
        }
      } catch {}
    }

    if (attempts.length === 0) {
      if (candidate.call1Status || candidate.call1Date) {
        attempts.push({
          attemptNumber: 1,
          callDate: candidate.call1Date || isoDate,
          formattedCallDate: candidate.call1Date || formattedDate,
          status: (candidate.call1Status as CallOutcome) || 'Not Answered',
          notes: candidate.call1Remarks || undefined,
          isQualifyingUnanswered: QUALIFYING_UNANSWERED_STATUSES.includes(
            candidate.call1Status || '',
          ),
        });
      }
      if (candidate.call2Status || candidate.call2Date) {
        attempts.push({
          attemptNumber: 2,
          callDate: candidate.call2Date || isoDate,
          formattedCallDate: candidate.call2Date || formattedDate,
          status: (candidate.call2Status as CallOutcome) || 'Not Answered',
          notes: candidate.call2Remarks || undefined,
          isQualifyingUnanswered: QUALIFYING_UNANSWERED_STATUSES.includes(
            candidate.call2Status || '',
          ),
        });
      }
      if (candidate.call3Status || candidate.call3Date) {
        attempts.push({
          attemptNumber: 3,
          callDate: candidate.call3Date || isoDate,
          formattedCallDate: candidate.call3Date || formattedDate,
          status: (candidate.call3Status as CallOutcome) || 'Not Answered',
          notes: candidate.call3Remarks || undefined,
          isQualifyingUnanswered: QUALIFYING_UNANSWERED_STATUSES.includes(
            candidate.call3Status || '',
          ),
        });
      }
    }

    const effectiveHrName =
      dto.callerHrName ||
      (isCallerHr1
        ? this.hrConfig?.hr1?.name
        : isCallerHr2
          ? this.hrConfig?.hr2?.name
          : candidate.assignedHrName) ||
      'Assigned HR';

    const targetAttemptNumber =
      dto.attemptNumber && [1, 2, 3].includes(dto.attemptNumber)
        ? dto.attemptNumber
        : attempts.length + 1;

    let callDateFormatted = formattedDate;
    if (dto.callDate) {
      const trimmed = dto.callDate.trim();
      if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
        callDateFormatted = this.formatServerDate(new Date(trimmed));
      } else {
        callDateFormatted = trimmed;
      }
    }

    const newAttempt: CallAttemptRecord = {
      attemptNumber: targetAttemptNumber,
      callDate: dto.callDate || isoDate,
      formattedCallDate: callDateFormatted,
      status: dto.status,
      assignedHrId: callerHrId || undefined,
      assignedHrName: effectiveHrName,
      assignedHrEmail: callerHrEmail || candidate.assignedHrEmail || undefined,
      notes: dto.notes?.trim() || undefined,
      nextFollowUpDate: dto.nextFollowUpDate?.trim() || undefined,
      isQualifyingUnanswered,
    };

    const existingIndex = attempts.findIndex(
      (a) => a.attemptNumber === targetAttemptNumber,
    );
    if (existingIndex >= 0) {
      attempts[existingIndex] = newAttempt;
    } else {
      attempts.push(newAttempt);
    }
    attempts.sort((a, b) => a.attemptNumber - b.attemptNumber);

    // Recalculate isQualifyingUnanswered authoritatively across all attempts
    attempts.forEach((a) => {
      a.isQualifyingUnanswered = QUALIFYING_UNANSWERED_STATUSES.includes(
        a.status,
      );
    });

    // Save updated history in Redis
    if (this.redisService?.client) {
      try {
        await this.redisService.client.set(
          `recruitment:candidate:calls:${candidateId}`,
          JSON.stringify(attempts),
          'EX',
          86400 * 90,
        );
      } catch {}
    }

    const totalCallAttempts = attempts.length;
    const qualifyingUnansweredCount = attempts.filter(
      (a) => a.isQualifyingUnanswered,
    ).length;

    // Separate call attempts (1st, 2nd, 3rd)
    const att1 = attempts.find((a) => a.attemptNumber === 1);
    const att2 = attempts.find((a) => a.attemptNumber === 2);
    const att3 = attempts.find((a) => a.attemptNumber === 3);

    const call1Date = att1
      ? att1.formattedCallDate || att1.callDate
      : candidate.call1Date || null;
    const call1Status = att1 ? att1.status : candidate.call1Status || null;
    const call1Remarks = att1
      ? att1.notes || null
      : candidate.call1Remarks || null;

    const call2Date = att2
      ? att2.formattedCallDate || att2.callDate
      : candidate.call2Date || null;
    const call2Status = att2 ? att2.status : candidate.call2Status || null;
    const call2Remarks = att2
      ? att2.notes || null
      : candidate.call2Remarks || null;

    const call3Date = att3
      ? att3.formattedCallDate || att3.callDate
      : candidate.call3Date || null;
    const call3Status = att3 ? att3.status : candidate.call3Status || null;
    const call3Remarks = att3
      ? att3.notes || null
      : candidate.call3Remarks || null;

    const call1DateAndStatus =
      call1Date && call1Status
        ? `${call1Date} - ${call1Status}`
        : candidate.call1DateAndStatus || null;
    const call2DateAndStatus =
      call2Date && call2Status
        ? `${call2Date} - ${call2Status}`
        : candidate.call2DateAndStatus || null;
    const call3DateAndStatus =
      call3Date && call3Status
        ? `${call3Date} - ${call3Status}`
        : candidate.call3DateAndStatus || null;

    const lastCallDate = callDateFormatted;
    const lastCallStatus = dto.status;
    const nextFollowUpDate =
      dto.nextFollowUpDate?.trim() || candidate.nextFollowUpDate || null;

    let updatedHrRemarks = candidate.hrRemarks || '';
    if (dto.notes?.trim()) {
      updatedHrRemarks = updatedHrRemarks
        ? `${updatedHrRemarks} | [Call ${newAttempt.attemptNumber}] ${dto.notes.trim()}`
        : `[Call ${newAttempt.attemptNumber}] ${dto.notes.trim()}`;
    }
    if (dto.status === 'Invalid Number') {
      updatedHrRemarks = updatedHrRemarks
        ? `${updatedHrRemarks} | [Invalid Phone Number reported by HR]`
        : '[Invalid Phone Number reported by HR]';
    }

    let automatedFollowUpEmailStatus =
      candidate.automatedFollowUpEmailStatus || 'NOT_SENT';
    let followUpEmailSentAt = candidate.followUpEmailSentAt || null;
    let emailTriggered = false;
    let emailResult: any = null;

    // Check if email was already sent (persistent idempotency)
    let alreadySent = automatedFollowUpEmailStatus === 'SENT';
    if (!alreadySent && this.redisService?.client) {
      try {
        const cached = await this.redisService.client.get(
          `candidate:followup_sent:${candidateId}`,
        );
        alreadySent = cached === 'SENT';
      } catch {}
    }

    // 5. Automated Follow-up Email Trigger (Requirements 7, 8, 9, 10)
    // Trigger ONLY on the 3rd qualifying unanswered attempt when exactly 3 qualifying attempts exist in history
    if (
      !alreadySent &&
      qualifyingUnansweredCount === 3 &&
      isQualifyingUnanswered
    ) {
      if (!this.isValidEmail(candidate.email)) {
        automatedFollowUpEmailStatus = 'FAILED_INVALID_EMAIL';
        emailResult = {
          sent: false,
          reason: 'Invalid candidate email address',
        };
      } else {
        emailResult = await this.sendAutomatedFollowUpEmail(
          candidate,
          attempts,
        );
        if (emailResult.sent) {
          emailTriggered = true;
          automatedFollowUpEmailStatus = 'SENT';
          followUpEmailSentAt = this.formatHumanReadableDate(new Date());
        } else if (
          emailResult.reason ===
          'Candidate has replied or exited follow-up workflow'
        ) {
          automatedFollowUpEmailStatus = 'SKIPPED_REPLIED';
        }
      }
    }

    // 7. Synchronize Google Sheets view (Requirements 6, 10)
    let sheetsSyncResult: any = null;
    if (this.googleSheetsService.isConfigured()) {
      try {
        sheetsSyncResult = await this.googleSheetsService.saveCandidate({
          id: candidate.id,
          name: candidate.name,
          email: candidate.email,
          phone: candidate.phone,
          jobRole: candidate.jobRole,
          assignedHrName: candidate.assignedHrName,
          screeningStatus: candidate.screeningStatus,
          applicationStatus: candidate.applicationStatus,
          totalCallAttempts,
          callCount: totalCallAttempts,
          call1Date,
          call1Status,
          call1Remarks,
          call2Date,
          call2Status,
          call2Remarks,
          call3Date,
          call3Status,
          call3Remarks,
          lastCallStatus,
          lastContactDate: lastCallDate,
          nextFollowUpDate,
          call1DateAndStatus,
          call2DateAndStatus,
          call3DateAndStatus,
          lastCallDate,
          automatedFollowUpEmailStatus,
          followUpEmailSentAt,
          hrRemarks: updatedHrRemarks,
        });
      } catch (sheetsErr: any) {
        this.logger.warn(
          `Google Sheets sync failed while recording call attempt for candidate ID ${candidate.id}`,
          { cause: this.googleSheetsService.sanitizeError(sheetsErr) },
        );
      }
    }

    return {
      success: true,
      candidateId: candidate.id,
      callAttempt: newAttempt,
      totalCallAttempts,
      qualifyingUnansweredCount,
      lastCallStatus,
      call1Date,
      call1Status,
      call1Remarks,
      call2Date,
      call2Status,
      call2Remarks,
      call3Date,
      call3Status,
      call3Remarks,
      call1DateAndStatus,
      call2DateAndStatus,
      call3DateAndStatus,
      lastCallDate,
      nextFollowUpDate,
      automatedFollowUpEmailStatus,
      followUpEmailSentAt,
      emailTriggered,
      emailResult,
      sheetsSyncResult,
    };
  }

  /**
   * Scheduled job polling Google Sheets every configured interval (default: 2 minutes)
   * to detect and reconcile HR call updates.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduledGoogleSheetsSync(): Promise<void> {
    if (!this.googleSheetsService.isConfigured()) {
      return;
    }

    const pollingConfig = this.googleSheetsService.getPollingConfig();
    if (!pollingConfig.pollingEnabled) {
      return;
    }

    const intervalMs = (pollingConfig.pollingIntervalMinutes || 2) * 60 * 1000;
    const now = Date.now();

    if (now - this.lastGoogleSheetsPollAt < intervalMs) {
      return;
    }

    await this.pollGoogleSheetsForCallUpdates({ triggerSource: 'SCHEDULED' });
  }

  /**
   * Reads the canonical Google Sheets Candidate Tracker, compares candidate call columns L:T
   * with authoritative persisted data, reconciles HR updates without creating duplicates,
   * updates Redis & Excel stores, and triggers the automated follow-up email when three
   * qualifying unanswered calls are recorded.
   */
  public async pollGoogleSheetsForCallUpdates(options?: {
    triggerSource?: 'SCHEDULED' | 'MANUAL';
    force?: boolean;
  }): Promise<GoogleSheetsPollResult> {
    const triggerSource = options?.triggerSource || 'SCHEDULED';
    const startTime = Date.now();
    const startedAt = new Date(startTime);

    if (!this.googleSheetsService.isConfigured()) {
      this.logger.warn(
        'Google Sheets service is not configured; skipping polling run',
      );
      return {
        status: 'SKIPPED',
        triggerSource,
        totalRows: 0,
        candidateRows: 0,
        changedCandidatesCount: 0,
        emailsTriggeredCount: 0,
        durationMs: 0,
        startedAt,
        completedAt: new Date(),
        details: [],
        message: 'Google Sheets service is not configured',
      };
    }

    // In-memory concurrency guard to prevent overlapping polling runs
    if (this.isPollingGoogleSheets) {
      this.logger.warn(
        'Google Sheets polling is already running; skipping overlapping execution',
      );
      return {
        status: 'SKIPPED',
        triggerSource,
        totalRows: 0,
        candidateRows: 0,
        changedCandidatesCount: 0,
        emailsTriggeredCount: 0,
        durationMs: 0,
        startedAt,
        completedAt: new Date(),
        details: [],
        message: 'Google Sheets polling is already in progress',
      };
    }

    // Distributed Redis lock for multi-instance deployments
    let lockAcquired = false;
    const redisLockKey = 'lock:google-sheets-polling';
    if (this.redisService?.client) {
      try {
        const lockRes = await this.redisService.client.set(
          redisLockKey,
          'LOCKED',
          'EX',
          120,
          'NX',
        );
        if (lockRes !== 'OK') {
          this.logger.warn(
            'Distributed lock for Google Sheets polling held by another process; skipping run',
          );
          return {
            status: 'SKIPPED',
            triggerSource,
            totalRows: 0,
            candidateRows: 0,
            changedCandidatesCount: 0,
            emailsTriggeredCount: 0,
            durationMs: 0,
            startedAt,
            completedAt: new Date(),
            details: [],
            message:
              'Google Sheets polling distributed lock held by another process',
          };
        }
        lockAcquired = true;
      } catch {}
    }

    this.isPollingGoogleSheets = true;
    this.logger.info('Google Sheets polling started for HR call tracking', {
      triggerSource,
    });

    try {
      let sheetRows: GoogleSheetTrackerRow[] = [];
      try {
        sheetRows = await this.googleSheetsService.readCandidateTrackerRows();
      } catch (readErr: any) {
        const sanitized = this.googleSheetsService.sanitizeError(readErr);
        this.logger.error(
          'Failed to read Candidate Tracker rows from Google Sheets',
          { error: sanitized },
        );
        return {
          status: 'FAILED',
          triggerSource,
          totalRows: 0,
          candidateRows: 0,
          changedCandidatesCount: 0,
          emailsTriggeredCount: 0,
          durationMs: Date.now() - startTime,
          startedAt,
          completedAt: new Date(),
          details: [],
          message: `Google Sheets read failed: ${sanitized}`,
        };
      }

      const QUALIFYING_UNANSWERED_STATUSES = [
        'Not Answered',
        'Busy',
        'Switched Off',
      ];
      const VALID_CALL_STATUSES = [
        'Not Answered',
        'Answered',
        'Busy',
        'Call Back Requested',
        'Invalid Number',
        'Switched Off',
      ];

      let changedCandidatesCount = 0;
      let emailsTriggeredCount = 0;
      const details: any[] = [];

      for (const sheetRow of sheetRows) {
        const candidateId = sheetRow.candidateId;
        if (!candidateId || isNaN(candidateId)) {
          continue;
        }

        try {
          const currentHash =
            this.googleSheetsService.computeCallTrackingHash(sheetRow);
          const lastSyncedHash =
            await this.googleSheetsService.getSyncedHash(candidateId);

          // Fast-path: If hash matches last known state and not forced, skip processing
          if (
            !options?.force &&
            lastSyncedHash &&
            lastSyncedHash === currentHash
          ) {
            details.push({
              candidateId,
              action: 'UNCHANGED',
            });
            continue;
          }

          // Fetch candidate from authoritative Excel store
          const candidate = await this.getCandidateById(candidateId);
          if (!candidate) {
            this.logger.warn(
              `Candidate ID ${candidateId} from Google Sheets was not found in authoritative candidate store`,
            );
            details.push({
              candidateId,
              action: 'SKIPPED_NOT_FOUND',
              error: 'Candidate not found in store',
            });
            continue;
          }

          // Load existing call history from Redis
          let attempts: CallAttemptRecord[] = [];
          if (this.redisService?.client) {
            try {
              const raw = await this.redisService.client.get(
                `recruitment:candidate:calls:${candidateId}`,
              );
              if (raw) {
                attempts = JSON.parse(raw);
              }
            } catch {}
          }

          // Reconcile calls from sheet (Attempts 1, 2, 3)
          const callsFromSheet = [
            {
              num: 1,
              date: sheetRow.call1Date,
              status: sheetRow.call1Status,
              remarks: sheetRow.call1Remarks,
            },
            {
              num: 2,
              date: sheetRow.call2Date,
              status: sheetRow.call2Status,
              remarks: sheetRow.call2Remarks,
            },
            {
              num: 3,
              date: sheetRow.call3Date,
              status: sheetRow.call3Status,
              remarks: sheetRow.call3Remarks,
            },
          ];

          let hasGenuineAttemptChange = false;

          for (const callDef of callsFromSheet) {
            const rawStatus = callDef.status?.trim() || '';
            if (!rawStatus) {
              // No status entered in sheet for this call attempt; preserve existing attempt if any
              continue;
            }

            const matchedStatus = VALID_CALL_STATUSES.find(
              (s) => s.toLowerCase() === rawStatus.toLowerCase(),
            );
            if (!matchedStatus) {
              this.logger.warn(
                `Ignoring unrecognized call status "${rawStatus}" for candidate ${candidateId} (Call ${callDef.num})`,
              );
              continue;
            }

            const existingAttempt = attempts.find(
              (a) => a.attemptNumber === callDef.num,
            );
            const rawDate = callDef.date?.trim() || '';
            const remarks = callDef.remarks?.trim() || '';

            let finalDate =
              existingAttempt?.callDate || new Date().toISOString();
            let finalFormattedDate =
              existingAttempt?.formattedCallDate ||
              this.formatServerDate(new Date());

            if (rawDate) {
              if (/^\d{4}-\d{2}-\d{2}T/.test(rawDate)) {
                finalDate = rawDate;
                finalFormattedDate = this.formatServerDate(new Date(rawDate));
              } else {
                finalDate = rawDate;
                finalFormattedDate = rawDate;
              }
            }

            const statusChanged =
              !existingAttempt || existingAttempt.status !== matchedStatus;
            const dateChanged =
              existingAttempt &&
              rawDate &&
              existingAttempt.formattedCallDate !== finalFormattedDate &&
              existingAttempt.callDate !== finalDate;
            const remarksChanged =
              (remarks || existingAttempt?.notes) &&
              (existingAttempt?.notes || '') !== remarks;

            if (
              !existingAttempt ||
              statusChanged ||
              dateChanged ||
              remarksChanged
            ) {
              hasGenuineAttemptChange = true;
              const newRecord: CallAttemptRecord = {
                attemptNumber: callDef.num,
                callDate: finalDate,
                formattedCallDate: finalFormattedDate,
                status: matchedStatus as CallOutcome,
                assignedHrName:
                  sheetRow.assignedHrName ||
                  candidate.assignedHrName ||
                  'Assigned HR',
                assignedHrEmail: candidate.assignedHrEmail,
                notes: remarks || undefined,
                nextFollowUpDate:
                  sheetRow.nextFollowUpDate ||
                  candidate.nextFollowUpDate ||
                  undefined,
                isQualifyingUnanswered:
                  QUALIFYING_UNANSWERED_STATUSES.includes(matchedStatus),
              };

              const exIdx = attempts.findIndex(
                (a) => a.attemptNumber === callDef.num,
              );
              if (exIdx >= 0) {
                attempts[exIdx] = newRecord;
              } else {
                attempts.push(newRecord);
              }
            }
          }

          attempts.sort((a, b) => a.attemptNumber - b.attemptNumber);
          attempts.forEach((a) => {
            a.isQualifyingUnanswered = QUALIFYING_UNANSWERED_STATUSES.includes(
              a.status,
            );
          });

          // Check if HR fields in sheet changed
          const appStatusChanged =
            sheetRow.applicationStatus &&
            sheetRow.applicationStatus !== candidate.applicationStatus;
          const roundChanged =
            sheetRow.currentInterviewRound &&
            sheetRow.currentInterviewRound !== candidate.currentInterviewRound;
          const nextDateChanged =
            sheetRow.nextFollowUpDate &&
            sheetRow.nextFollowUpDate !== candidate.nextFollowUpDate;
          const hrRemarksChanged =
            sheetRow.hrRemarks && sheetRow.hrRemarks !== candidate.hrRemarks;

          const hasTrackingFieldChange =
            !lastSyncedHash ||
            lastSyncedHash !== currentHash ||
            hasGenuineAttemptChange ||
            appStatusChanged ||
            roundChanged ||
            nextDateChanged ||
            hrRemarksChanged;

          if (hasTrackingFieldChange) {
            changedCandidatesCount++;

            // 1. Save updated call attempts in Redis
            if (this.redisService?.client) {
              try {
                await this.redisService.client.set(
                  `recruitment:candidate:calls:${candidateId}`,
                  JSON.stringify(attempts),
                  'EX',
                  86400 * 90,
                );
              } catch {}
            }

            const totalCallAttempts = attempts.length;
            const qualifyingUnansweredCount = attempts.filter(
              (a) => a.isQualifyingUnanswered,
            ).length;

            const att1 = attempts.find((a) => a.attemptNumber === 1);
            const att2 = attempts.find((a) => a.attemptNumber === 2);
            const att3 = attempts.find((a) => a.attemptNumber === 3);

            const call1Date = att1
              ? att1.formattedCallDate || att1.callDate
              : candidate.call1Date || null;
            const call1Status = att1
              ? att1.status
              : candidate.call1Status || null;
            const call1Remarks = att1
              ? att1.notes || null
              : candidate.call1Remarks || null;

            const call2Date = att2
              ? att2.formattedCallDate || att2.callDate
              : candidate.call2Date || null;
            const call2Status = att2
              ? att2.status
              : candidate.call2Status || null;
            const call2Remarks = att2
              ? att2.notes || null
              : candidate.call2Remarks || null;

            const call3Date = att3
              ? att3.formattedCallDate || att3.callDate
              : candidate.call3Date || null;
            const call3Status = att3
              ? att3.status
              : candidate.call3Status || null;
            const call3Remarks = att3
              ? att3.notes || null
              : candidate.call3Remarks || null;

            const call1DateAndStatus =
              call1Date && call1Status
                ? `${call1Date} - ${call1Status}`
                : candidate.call1DateAndStatus || null;
            const call2DateAndStatus =
              call2Date && call2Status
                ? `${call2Date} - ${call2Status}`
                : candidate.call2DateAndStatus || null;
            const call3DateAndStatus =
              call3Date && call3Status
                ? `${call3Date} - ${call3Status}`
                : candidate.call3DateAndStatus || null;

            const lastAttempt = attempts[attempts.length - 1];
            const lastCallStatus = lastAttempt
              ? lastAttempt.status
              : candidate.lastCallStatus;
            const lastCallDate = lastAttempt
              ? lastAttempt.formattedCallDate || lastAttempt.callDate
              : candidate.lastContactDate || null;

            let automatedFollowUpEmailStatus =
              candidate.automatedFollowUpEmailStatus || 'NOT_SENT';
            let followUpEmailSentAt = candidate.followUpEmailSentAt || null;
            let emailTriggered = false;

            // Check persistent idempotency: email must never be sent more than once
            let alreadySent =
              automatedFollowUpEmailStatus === 'SENT' ||
              sheetRow.automatedFollowUpEmailStatus === 'SENT';

            if (!alreadySent && this.redisService?.client) {
              try {
                const cached = await this.redisService.client.get(
                  `candidate:followup_sent:${candidateId}`,
                );
                alreadySent = cached === 'SENT';
              } catch {}
            }

            // Trigger automated follow-up email if exactly 3 qualifying unanswered attempts exist
            if (!alreadySent && qualifyingUnansweredCount === 3) {
              if (this.isValidEmail(candidate.email)) {
                const emailResult = await this.sendAutomatedFollowUpEmail(
                  candidate,
                  attempts,
                );
                if (emailResult.sent) {
                  emailTriggered = true;
                  emailsTriggeredCount++;
                  automatedFollowUpEmailStatus = 'SENT';
                  followUpEmailSentAt = this.formatHumanReadableDate(
                    new Date(),
                  );
                  // Update Google Sheets columns V and W
                  try {
                    await this.googleSheetsService.updateFollowUpEmailStatusInSheet(
                      candidateId,
                      'SENT',
                      followUpEmailSentAt,
                    );
                  } catch (sheetUpdateErr: any) {
                    this.logger.warn(
                      `Failed to update email status in Google Sheets for candidate ${candidateId}`,
                      {
                        cause:
                          this.googleSheetsService.sanitizeError(
                            sheetUpdateErr,
                          ),
                      },
                    );
                  }
                } else if (
                  emailResult.reason ===
                  'Candidate has replied or exited follow-up workflow'
                ) {
                  automatedFollowUpEmailStatus = 'SKIPPED_REPLIED';
                  try {
                    await this.googleSheetsService.updateFollowUpEmailStatusInSheet(
                      candidateId,
                      'SKIPPED_REPLIED',
                      this.formatHumanReadableDate(new Date()),
                    );
                  } catch (sheetUpdateErr: any) {
                    this.logger.warn(
                      `Failed to update skipped email status in Google Sheets for candidate ${candidateId}`,
                      {
                        cause:
                          this.googleSheetsService.sanitizeError(
                            sheetUpdateErr,
                          ),
                      },
                    );
                  }
                }
              } else {
                automatedFollowUpEmailStatus = 'FAILED_INVALID_EMAIL';
              }
            }

            // 3. Update the synced hash in Redis to prevent loop
            const updatedRowForHash = {
              ...sheetRow,
              automatedFollowUpEmailStatus,
              followUpEmailSentAt,
            };
            const newComputedHash =
              this.googleSheetsService.computeCallTrackingHash(
                updatedRowForHash,
              );
            await this.googleSheetsService.recordSyncedHash(
              candidateId,
              newComputedHash,
            );

            details.push({
              candidateId,
              action: 'RECONCILED',
              qualifyingUnansweredCount,
              emailTriggered,
            });
          } else {
            // No substantive changes; update hash in Redis so next poll is skipped
            await this.googleSheetsService.recordSyncedHash(
              candidateId,
              currentHash,
            );
            details.push({
              candidateId,
              action: 'UNCHANGED',
            });
          }
        } catch (rowErr: any) {
          const sanitized = this.googleSheetsService.sanitizeError(rowErr);
          this.logger.error(
            `Error reconciling candidate ID ${candidateId} from Google Sheets`,
            { error: sanitized },
          );
          details.push({
            candidateId,
            action: 'ERROR',
            error: sanitized,
          });
        }
      }

      const durationMs = Date.now() - startTime;
      this.logger.info('Google Sheets polling completed', {
        totalRows: sheetRows.length,
        changedCandidatesCount,
        emailsTriggeredCount,
        durationMs,
      });

      return {
        status: 'SUCCESS',
        triggerSource,
        totalRows: sheetRows.length,
        candidateRows: sheetRows.length,
        changedCandidatesCount,
        emailsTriggeredCount,
        durationMs,
        startedAt,
        completedAt: new Date(),
        details,
      };
    } finally {
      this.isPollingGoogleSheets = false;
      this.lastGoogleSheetsPollAt = Date.now();
      if (lockAcquired && this.redisService?.client) {
        try {
          await this.redisService.client.del(redisLockKey);
        } catch {}
      }
    }
  }

  /**
   * Safely reconciles existing candidates that were incorrectly assigned to "Manual Review"
   * despite qualifying for recruitment roles with an ATS score >= 60.
   * Preserves all existing call tracking, interview rounds, dates, and manual HR remarks.
   * Does NOT overwrite legitimate manual review decisions or non-recruitment assignments.
   */
  public async reconcileMisassignedRecruitmentCandidates(): Promise<{
    scanned: number;
    reconciled: number;
    skipped: number;
    details: Array<{
      id: number;
      name: string;
      role: string;
      matchScore: number;
      oldHr: string;
      newHr: string;
      reconciledInExcel: boolean;
      reconciledInGoogleSheets: boolean;
    }>;
  }> {
    let candidates: any[] = [];
    if (this.googleSheetsService?.isConfigured()) {
      try {
        const sheetRows =
          await this.googleSheetsService.readCandidateTrackerRows();
        candidates = sheetRows.map((row) =>
          this.mapGoogleSheetRowToCandidateRecord(row),
        );
      } catch (err: any) {
        this.logger.warn(
          `Failed to read candidates from Google Sheets for HR reconciliation: ${err.message}`,
        );
      }
    }
    if (candidates.length === 0) {
      candidates = await this.candidateExcelService.getAllCandidates();
    }
    let reconciledCount = 0;
    let skippedCount = 0;
    const details: any[] = [];

    const hr2Name = (this.hrConfig?.hr2?.name || 'Jayendra').trim();
    const hr2Email = (this.hrConfig?.hr2?.email || '').trim();
    const manualReviewEmail = (this.hrConfig?.manualReviewEmail || '')
      .trim()
      .toLowerCase();

    for (const candidate of candidates) {
      const candidateId = candidate.id;
      const role = candidate.jobRole || candidate.normalizedRole || '';
      const isRecruitment = this.hrAssignmentService.isRecruitmentRole(role);
      const score = Number(candidate.matchScore) || 0;
      const statusUpper = String(
        candidate.screeningStatus || candidate.applicationStatus || '',
      ).toUpperCase();
      const isShortlisted = statusUpper.includes('SHORTLIST');

      const currentHrName = (candidate.assignedHrName || '').trim();
      const currentHrEmail = (candidate.assignedHrEmail || '')
        .trim()
        .toLowerCase();

      // Only evaluate candidates currently assigned to Manual Review or Unassigned
      const isAssignedToManualReview =
        currentHrName === 'Manual Review' ||
        currentHrName === 'Unassigned' ||
        !currentHrName ||
        (manualReviewEmail && currentHrEmail === manualReviewEmail);

      // Business Rule: HR2 is Jayendra and is responsible for recruitment.
      // Must qualify for recruitment role, meet the shortlist threshold (>= 60), and be shortlisted.
      const isEligibleForRecruitmentHr2 =
        isRecruitment &&
        score >= 60 &&
        isShortlisted &&
        isAssignedToManualReview;

      if (!isEligibleForRecruitmentHr2) {
        skippedCount++;
        continue;
      }

      this.logger.info(
        `Reconciling misassigned recruitment candidate ID ${candidateId} (${candidate.name}, Score: ${score}) to ${hr2Name}`,
      );

      let reconciledInGoogleSheets = false;

      // 2. Update in Google Sheets, preserving existing tracking fields
      if (this.googleSheetsService.isConfigured()) {
        try {
          const cleanPhone = candidate.phone
            ? candidate.phone.replace(/^['’`]+/, '').trim()
            : null;

          await this.googleSheetsService.saveCandidate({
            id: candidateId,
            name: candidate.name,
            email: candidate.email,
            phone: cleanPhone,
            jobRole: candidate.jobRole,
            assignedHrName: hr2Name,
            screeningStatus: candidate.screeningStatus,
            applicationStatus: candidate.applicationStatus,
            hrRemarks: candidate.hrRemarks || undefined,
            currentInterviewRound: candidate.currentInterviewRound,
            totalCallAttempts: candidate.totalCallAttempts,
            call1Date: candidate.call1Date,
            call1Status: candidate.call1Status,
            call1Remarks: candidate.call1Remarks,
            call2Date: candidate.call2Date,
            call2Status: candidate.call2Status,
            call2Remarks: candidate.call2Remarks,
            call3Date: candidate.call3Date,
            call3Status: candidate.call3Status,
            call3Remarks: candidate.call3Remarks,
            nextFollowUpDate: candidate.nextFollowUpDate,
            automatedFollowUpEmailStatus:
              candidate.automatedFollowUpEmailStatus,
            followUpEmailSentAt: candidate.followUpEmailSentAt,
          });
          reconciledInGoogleSheets = true;
        } catch (sheetsErr: any) {
          this.logger.error(
            `Failed to update Google Sheets for candidate ID ${candidateId}`,
            { cause: this.googleSheetsService.sanitizeError(sheetsErr) },
          );
        }
      }

      reconciledCount++;
      details.push({
        id: candidateId,
        name: candidate.name,
        role: candidate.jobRole,
        matchScore: score,
        oldHr: currentHrName || 'Manual Review',
        newHr: hr2Name,
        reconciledInExcel: false,
        reconciledInGoogleSheets,
      });
    }

    this.logger.info('Candidate HR assignment reconciliation completed', {
      scanned: candidates.length,
      reconciled: reconciledCount,
      skipped: skippedCount,
    });

    return {
      scanned: candidates.length,
      reconciled: reconciledCount,
      skipped: skippedCount,
      details,
    };
  }
  public async updateCandidateTracking(
    candidateId: number,
    dto: UpdateCandidateTrackingDto,
    user?: any,
  ): Promise<{
    success: boolean;
    candidateId: number;
    updated: any;
  }> {
    if (!candidateId || isNaN(candidateId)) {
      throw new BadRequestException('Invalid candidate ID');
    }

    const candidate = await this.getCandidateById(candidateId);

    // Permission check: Admin can update any; HR can update candidates assigned to them
    const isUserAdmin = user?.type === 'admin' || user?.role === 'Admin';
    const userIdentifier = (
      user?.name ||
      user?.email ||
      user?.username ||
      ''
    ).toLowerCase();
    const assignedName = (candidate.assignedHrName || '').toLowerCase();
    const assignedEmail = (candidate.assignedHrEmail || '').toLowerCase();

    if (!isUserAdmin && userIdentifier) {
      const isOwner =
        (assignedName && userIdentifier.includes(assignedName)) ||
        (assignedEmail && userIdentifier === assignedEmail) ||
        (user?.name && user.name.toLowerCase() === assignedName);

      if (!isOwner) {
        throw new ForbiddenException(
          'You do not have permission to update this record. Only its owner or a manager/admin can.',
        );
      }
    }

    const lastUpdatedBy = user?.name || user?.email || 'Headquarter Portal';
    const lastUpdatedAt = new Date().toISOString().split('T')[0];

    const updates: any = {
      id: candidate.id,
      screeningStatus: candidate.screeningStatus,
      applicationStatus: candidate.applicationStatus,
      lastUpdatedBy,
      lastUpdatedAt,
    };

    if (dto.currentInterviewRound) {
      updates.currentInterviewRound = dto.currentInterviewRound;
    }
    if (dto.hrRemarks) {
      updates.hrRemarks = dto.hrRemarks;
    }

    const key =
      dto.key ||
      (dto.callbackStatus ? 'status' : dto.callStatus ? 'call' : undefined);
    const value = dto.value || dto.callbackStatus || dto.callStatus;

    if (key === 'status' || dto.callbackStatus !== undefined) {
      const statusVal = dto.callbackStatus || dto.value || '';
      if (statusVal === 'Completed') {
        updates.currentInterviewRound =
          candidate.currentInterviewRound === 'Not Started'
            ? 'HR Round'
            : candidate.currentInterviewRound;
        updates.call1Status = 'Answered';
      } else if (statusVal === 'Missed') {
        updates.call1Status = 'Not Answered';
      }
      if (this.redisService?.client) {
        try {
          await this.redisService.client.set(
            `candidate:tracking:status:${candidateId}`,
            statusVal,
            'EX',
            86400 * 30,
          );
        } catch {}
      }
    }

    if (key === 'call' || dto.callStatus !== undefined) {
      const callVal = dto.callStatus || dto.value || '';
      if (this.redisService?.client) {
        try {
          await this.redisService.client.set(
            `candidate:tracking:call:${candidateId}`,
            callVal,
            'EX',
            86400 * 30,
          );
        } catch {}
      }
    }

    if (this.googleSheetsService.isConfigured()) {
      try {
        await this.googleSheetsService.saveCandidate(updates);
      } catch (err: any) {
        this.logger.error(
          `Failed to save candidate tracking update to Google Sheets for ID ${candidateId}: ${err.message}`,
        );
        throw new InternalServerErrorException(
          'Google Sheets is temporarily unavailable. Could not save update.',
        );
      }
    }

    return {
      success: true,
      candidateId,
      updated: {
        key,
        value,
        lastUpdatedBy,
        lastUpdatedAt,
        ...dto,
      },
    };
  }

  /**
   * Safe, idempotent backfill process to link existing Google Sheets candidates to their Drive CVs.
   * - Finds rows in Google Sheets where Col AA (CV Link) and/or Col AB (Drive File ID) are empty.
   * - Confidently matches candidates to existing Drive files or original Gmail attachments.
   * - Only updates Columns AA:AB using updateCandidateDriveColumns() to guarantee columns A:Z are untouched.
   * - If a candidate cannot be confidently matched, leaves cells unchanged and marks for MANUAL_REVIEW.
   * - Defaults to dryRun: true (safe mode) so proposed changes can be inspected without modifying production data.
   */
  public async planOrExecuteDriveBackfill(options?: {
    dryRun?: boolean;
    limit?: number;
  }): Promise<{
    dryRun: boolean;
    totalRowsInspected: number;
    alreadyPopulatedCount: number;
    matchedCount: number;
    manualReviewCount: number;
    results: Array<{
      candidateId: number;
      rowNumber: number;
      candidateName: string;
      email: string;
      role: string;
      action: 'MATCHED' | 'MANUAL_REVIEW' | 'ALREADY_POPULATED';
      matchedFileId?: string;
      matchedCvLink?: string;
      source?: 'EXISTING_DRIVE_FILE' | 'GMAIL_ATTACHMENT_REUPLOAD';
      reason?: string;
    }>;
  }> {
    const isDryRun = options?.dryRun !== false; // Default: true for safety
    const limit = options?.limit || 100;

    if (!this.googleSheetsService.isConfigured()) {
      throw new Error('Google Sheets is not configured');
    }

    const trackerRows =
      await this.googleSheetsService.readCandidateTrackerRows();
    const results: Array<{
      candidateId: number;
      rowNumber: number;
      candidateName: string;
      email: string;
      role: string;
      action: 'MATCHED' | 'MANUAL_REVIEW' | 'ALREADY_POPULATED';
      matchedFileId?: string;
      matchedCvLink?: string;
      source?: 'EXISTING_DRIVE_FILE' | 'GMAIL_ATTACHMENT_REUPLOAD';
      reason?: string;
    }> = [];

    let alreadyPopulatedCount = 0;
    let matchedCount = 0;
    let manualReviewCount = 0;

    // Load available Drive files if Drive service is available and configured
    let driveFiles: any[] = [];
    if (this.googleDriveService?.isConfigured()) {
      try {
        driveFiles = await this.googleDriveService.scanNewCvFiles({
          includeProcessed: true,
        });
      } catch (err: any) {
        this.logger.warn(
          `Could not pre-scan Drive files during backfill: ${err.message}`,
        );
      }
    }

    // Load queue jobs if available
    const screeningJobsFile = path.resolve(
      process.cwd(),
      'data',
      process.env.NODE_ENV === 'test'
        ? 'screening-jobs.test.json'
        : 'screening-jobs.json',
    );
    let queueJobs: any[] = [];
    if (fs.existsSync(screeningJobsFile)) {
      try {
        queueJobs = JSON.parse(fs.readFileSync(screeningJobsFile, 'utf-8'));
      } catch {}
    }

    for (const trackerRow of trackerRows.slice(0, limit)) {
      const {
        candidateId,
        candidateName,
        email,
        jobRole,
        driveFileId,
        cvLink,
      } = trackerRow;
      const rowNumber = (trackerRow as any).rowNumber || trackerRow.rowIndex;

      // 1. Idempotency check: If already populated with valid link and file ID, skip
      if (driveFileId && driveFileId.trim() && cvLink && cvLink.trim()) {
        alreadyPopulatedCount++;
        results.push({
          candidateId,
          rowNumber,
          candidateName,
          email,
          role: jobRole,
          action: 'ALREADY_POPULATED',
          matchedFileId: driveFileId,
          matchedCvLink: cvLink,
        });
        continue;
      }

      // 2. Attempt confident match via existing Drive files
      let matchedFileId: string | undefined;
      let matchedCvLink: string | undefined;
      let matchSource:
        | 'EXISTING_DRIVE_FILE'
        | 'GMAIL_ATTACHMENT_REUPLOAD'
        | undefined;

      const normEmail = (email || '').trim().toLowerCase();

      // Check drive files by name (Candidate_{id}_)
      if (driveFiles.length > 0) {
        const fileMatch = driveFiles.find((f) => {
          const lowerName = f.name.toLowerCase();
          return lowerName.includes(`candidate_${candidateId}_`);
        });

        if (fileMatch) {
          matchedFileId = fileMatch.fileId;
          matchedCvLink = `=HYPERLINK("https://drive.google.com/file/d/${matchedFileId}/view", "View CV")`;
          matchSource = 'EXISTING_DRIVE_FILE';
        }
      }

      // 3. If no Drive file found, check if original Gmail resume attachment can be confidently identified
      if (!matchedFileId && queueJobs.length > 0 && normEmail) {
        const matchingJob = queueJobs.find(
          (j) =>
            j.sender?.email?.trim().toLowerCase() === normEmail ||
            (j.candidateId !== undefined && j.candidateId === candidateId),
        );

        if (matchingJob?.driveFileId) {
          matchedFileId = matchingJob.driveFileId;
          matchedCvLink =
            matchingJob.cvLink ||
            `=HYPERLINK("https://drive.google.com/file/d/${matchedFileId}/view", "View CV")`;
          matchSource = 'EXISTING_DRIVE_FILE';
        } else if (
          matchingJob?.messageId &&
          matchingJob?.attachmentId &&
          this.googleDriveService?.isConfigured()
        ) {
          if (!isDryRun) {
            try {
              const buffer = await this.gmailService.downloadAttachment(
                matchingJob.messageId,
                matchingJob.attachmentId,
              );
              if (buffer && buffer.length > 0) {
                const uploadResult = await this.googleDriveService.uploadCv({
                  buffer,
                  filename: matchingJob.filename,
                  mimeType: matchingJob.mimeType,
                  candidateId,
                  candidateEmail: email,
                  candidateName,
                  role: jobRole,
                });
                matchedFileId = uploadResult.fileId;
                matchedCvLink = uploadResult.cvLink;
                matchSource = 'GMAIL_ATTACHMENT_REUPLOAD';
                await this.googleDriveService.markFileProcessed(
                  uploadResult.fileId,
                  candidateId,
                );
              }
            } catch (upErr: any) {
              this.logger.warn(
                `Backfill upload failed for candidate ID ${candidateId}: ${upErr.message}`,
              );
            }
          } else {
            // In dry-run mode, simulate proposed match via Gmail attachment
            matchedFileId = `[PROPOSED_DRIVE_UPLOAD_FROM_GMAIL:${matchingJob.messageId}]`;
            matchedCvLink = `=HYPERLINK("[PROPOSED_VIEW_CV]", "View CV")`;
            matchSource = 'GMAIL_ATTACHMENT_REUPLOAD';
          }
        }
      }

      // 4. If matched and not dry-run, execute the safe Google Sheets AA:AB write
      if (matchedFileId && matchedCvLink) {
        if (!isDryRun && matchSource !== undefined) {
          try {
            await this.googleSheetsService.updateCandidateDriveColumns(
              rowNumber,
              matchedFileId,
              matchedCvLink,
            );
          } catch (writeErr: any) {
            this.logger.error(
              `Failed writing Drive columns for candidate ${candidateId} at row ${rowNumber}: ${writeErr.message}`,
            );
          }
        }

        matchedCount++;
        results.push({
          candidateId,
          rowNumber,
          candidateName,
          email,
          role: jobRole,
          action: 'MATCHED',
          matchedFileId,
          matchedCvLink,
          source: matchSource,
        });
      } else {
        manualReviewCount++;
        results.push({
          candidateId,
          rowNumber,
          candidateName,
          email,
          role: jobRole,
          action: 'MANUAL_REVIEW',
          reason:
            'Could not confidently match candidate to a Drive file or Gmail attachment',
        });
      }
    }

    return {
      dryRun: isDryRun,
      totalRowsInspected: trackerRows.length,
      alreadyPopulatedCount,
      matchedCount,
      manualReviewCount,
      results,
    };
  }
}
