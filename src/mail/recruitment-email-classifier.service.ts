import { Injectable, Optional } from '@nestjs/common';
import { BaseService } from '@Common';
import { RedisService } from '../redis';
import { RoleDetectionService } from './role-detection.service';
import { GmailAttachmentMeta, GmailMessageDetail } from './gmail.types';

export type ClassificationDecision =
  | 'RECRUITMENT_APPLICATION'
  | 'UNRELATED_EMAIL'
  | 'UNSUPPORTED_ATTACHMENT'
  | 'AMBIGUOUS';

export type ClassificationAuditReason =
  | 'RECRUITMENT_MATCH'
  | 'NO_APPLICATION_CONTEXT'
  | 'UNSUPPORTED_ATTACHMENT'
  | 'AMBIGUOUS_EMAIL';

export interface EmailClassificationResult {
  decision: ClassificationDecision;
  auditReason: ClassificationAuditReason;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  detectedRole?: string;
  canonicalRole?: string;
  matchedIndicators: string[];
  rejectionReason?: string;
  explanation: string;
}

export interface AmbiguousReviewRecord {
  messageId: string;
  threadId?: string;
  subjectSnippet: string;
  senderDomain?: string;
  receivedDate: string;
  auditReason: ClassificationAuditReason;
  matchedIndicators: string[];
  explanation: string;
  createdAt: string;
}

@Injectable()
export class RecruitmentEmailClassifierService extends BaseService {
  public static readonly AMBIGUOUS_SET_KEY = 'recruitment:ambiguous_messages';
  private readonly roleDetectionService: RoleDetectionService;

  constructor(
    @Optional()
    private readonly redisService?: RedisService,
    @Optional()
    roleDetectionService?: RoleDetectionService,
  ) {
    super({
      loggerDefaultMeta: { service: RecruitmentEmailClassifierService.name },
    });
    this.roleDetectionService =
      roleDetectionService || new RoleDetectionService();
  }

  /**
   * Sanitizes text for safe pattern matching.
   */
  private normalize(text?: string | null): string {
    if (!text) return '';
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Sanitizes email subject or text for audit logging without leaking PII.
   */
  public sanitizeSnippet(text?: string | null, maxLength = 60): string {
    if (!text) return '(no subject)';
    const clean = text.replace(/[\r\n\t]+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    return `${clean.substring(0, maxLength)}...`;
  }

  /**
   * Extracts domain safely from sender email to avoid logging full personal addresses.
   */
  public extractSenderDomain(email?: string): string {
    if (!email) return 'unknown';
    const atIdx = email.indexOf('@');
    if (atIdx === -1) return 'unknown';
    return email.substring(atIdx + 1).toLowerCase();
  }

  /**
   * Evaluates if an attachment metadata indicates a potential resume (PDF or DOCX),
   * while filtering out obvious non-resume filenames (e.g. invoice.pdf, flyer.pdf).
   */
  public isPotentialResumeAttachment(att: GmailAttachmentMeta): boolean {
    const filename = (att.filename || '').toLowerCase();
    const mime = (att.mimeType || '').toLowerCase();

    const isPdfOrDocx =
      filename.endsWith('.pdf') ||
      filename.endsWith('.docx') ||
      mime === 'application/pdf' ||
      mime ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (!isPdfOrDocx) return false;

    // Reject non-resume filenames even if they are PDF/DOCX
    const isExcludedDoc =
      /\b(invoice|receipt|bill|statement|slip|form-?16|tax|flyer|diwali|holiday|brochure|invitation|banner|agenda|ticket|menu|manual|handbook|guide|policy)\b/i.test(
        filename,
      );

    return !isExcludedDoc;
  }

  /**
   * Evaluates an email against explicit exclusion rules:
   * Calendar invites, holiday notices, billing, newsletters, devops alerts, internal memos.
   */
  private checkExclusionRules(
    subject: string,
    body: string,
    attachments: GmailAttachmentMeta[],
  ): { isExcluded: boolean; indicator?: string; reason?: string } {
    // 1. Calendar / Meeting Invitations
    const isCalendarInvite =
      /^(?:invitation|invited|accepted|declined|tentative|updated invitation|canceled invitation|event):/i.test(
        subject,
      ) ||
      /\b(?:google calendar|zoom meeting|microsoft teams meeting|meeting invitation|webex meeting)\b/i.test(
        subject,
      ) ||
      attachments.some(
        (a) =>
          (a.filename && a.filename.toLowerCase().endsWith('.ics')) ||
          a.mimeType === 'text/calendar',
      );

    if (isCalendarInvite) {
      return {
        isExcluded: true,
        indicator: 'EXCLUSION_CALENDAR_INVITATION',
        reason: 'Calendar invitation or meeting notification',
      };
    }

    // 2. Company Announcements, Holidays, Celebrations
    const isHolidayOrCompanyAnnouncement =
      /\b(?:holiday announcement|office holiday|office (?:will remain|is) closed|diwali (?:wishes|celebration|holiday|greetings)|happy diwali|happy new year|independence day|republic day|christmas celebration|festival greetings|annual picnic|team outing|company event|town hall meeting)\b/i.test(
        subject,
      ) ||
      (/\b(?:office (?:will remain|is) closed|wishing (?:everyone|all of you) a (?:very )?happy|celebrating diwali)\b/i.test(
        body,
      ) &&
        !/\b(?:apply|resume|cv|hiring|candidacy)\b/i.test(subject));

    if (isHolidayOrCompanyAnnouncement) {
      return {
        isExcluded: true,
        indicator: 'EXCLUSION_HOLIDAY_ANNOUNCEMENT',
        reason: 'Company holiday, festival greeting, or event announcement',
      };
    }

    // 3. Invoices, Billing, Receipts, Accounting
    const isInvoiceOrBilling =
      /\b(?:invoice\s*#?|receipt\s*#?|bill\s*#?|payment receipt|billing statement|purchase order|tax invoice|payment confirmation|statement of account)\b/i.test(
        subject,
      ) ||
      attachments.some((a) =>
        /\b(?:invoice|receipt|tax_invoice|statement_of_account|payment_receipt)\b/i.test(
          a.filename || '',
        ),
      );

    if (isInvoiceOrBilling) {
      return {
        isExcluded: true,
        indicator: 'EXCLUSION_INVOICE_BILLING',
        reason: 'Invoice, billing statement, or payment receipt',
      };
    }

    // 4. Newsletters, Automated Digests, Marketing
    const isNewsletterOrMarketing =
      /\b(?:newsletter|weekly digest|monthly digest|daily digest|product update|marketing newsletter)\b/i.test(
        subject,
      ) ||
      (/\b(?:unsubscribe|view in browser|manage your preferences|privacy policy|opt[\s-]out)\b/i.test(
        body,
      ) &&
        !/\b(?:applied for|submitting my resume|application for)\b/i.test(
          body,
        ));

    if (isNewsletterOrMarketing) {
      return {
        isExcluded: true,
        indicator: 'EXCLUSION_NEWSLETTER_MARKETING',
        reason: 'Marketing newsletter, mailing list digest, or automated blast',
      };
    }

    // 5. DevOps, Server Health, Infrastructure Alerts
    // Note: Do not treat words like "developer" in a devops/server context as a job application
    const isDevOpsAlert =
      /\b(?:deployment (?:status|alert|successful|failed)|build (?:failed|passed|successful)|ci\/cd|server (?:down|alert|monitoring|health|restart)|pagerduty|sentry issue|uptime monitor|cron job alert|github actions|gitlab pipeline)\b/i.test(
        subject,
      ) ||
      (/\b(?:server (?:is )?down|deployment failed|build pipeline)\b/i.test(
        body,
      ) &&
        !/\b(?:apply|resume|cv)\b/i.test(subject));

    if (isDevOpsAlert) {
      return {
        isExcluded: true,
        indicator: 'EXCLUSION_DEVOPS_ALERT',
        reason: 'DevOps, infrastructure alert, or system notification',
      };
    }

    // 6. Internal HR / Administrative Circulars
    const isInternalMemo =
      /\b(?:posh (?:training|policy|awareness|circular)|payroll (?:update|reminder)|salary slip|payslip|timesheet (?:reminder|submission)|attendance policy|appraisal form|quarterly review memo)\b/i.test(
        subject,
      );

    if (isInternalMemo) {
      return {
        isExcluded: true,
        indicator: 'EXCLUSION_INTERNAL_MEMO',
        reason:
          'Internal administrative memo, policy circular, or payroll notice',
      };
    }

    return { isExcluded: false };
  }

  /**
   * Classifies an incoming Gmail message BEFORE downloading attachments or creating screening jobs.
   */
  public classifyEmail(message: GmailMessageDetail): EmailClassificationResult {
    const subject = message.subject || '';
    const body = message.textBody || message.snippet || '';
    const normSubject = this.normalize(subject);
    const normBody = this.normalize(body);
    const combinedText = `${normSubject} ${normBody}`;
    const attachments = message.attachments || [];

    const matchedIndicators: string[] = [];

    // Step 1: Check clean exclusions first
    const exclusion = this.checkExclusionRules(subject, body, attachments);
    if (exclusion.isExcluded) {
      matchedIndicators.push(exclusion.indicator!);
      return {
        decision: 'UNRELATED_EMAIL',
        auditReason: 'NO_APPLICATION_CONTEXT',
        confidence: 'HIGH',
        matchedIndicators,
        rejectionReason: exclusion.reason,
        explanation: `Excluded non-recruitment message: ${exclusion.reason}`,
      };
    }

    // Step 2: Check for genuine recruitment application intent
    // 2a. Direct application language
    const hasApplicationPhrasing =
      /\b(?:apply(?:ing)? for|applied for|job application|application for|candidacy for|interested in (?:the|working at|the role of|the position of)|submitting my (?:application|resume|cv)|submission of my (?:application|resume|cv)|consider my (?:application|candidacy|profile|resume|cv))\b/i.test(
        combinedText,
      ) ||
      /\b(?:please find (?:my|the)?\s*(?:attached)?\s*(?:updated)?\s*(?:resume|cv)|attached (?:is|my) (?:resume|cv|biodata)|attaching my (?:resume|cv|biodata)|enclosed is my (?:resume|cv))\b/i.test(
        combinedText,
      ) ||
      /\b(?:seeking|looking for)\s+(?:a|an)?\s*(?:opportunity|position|role|job|internship|full[\s-]?time role)\b/i.test(
        combinedText,
      );

    if (hasApplicationPhrasing) {
      matchedIndicators.push('CANDIDATE_APPLICATION_LANGUAGE');
    }

    // 2b. Forwarded application check
    const isForwarded =
      /^(?:\[?fwd?\]?:\s*|fw:\s*)/i.test(subject) ||
      /---------- Forwarded message ---------/i.test(body) ||
      /\b(?:forwarding (?:the )?(?:application|resume|cv|candidacy)|candidate resume for review)\b/i.test(
        combinedText,
      );

    if (isForwarded) {
      matchedIndicators.push('FORWARDED_APPLICATION');
    }

    // 2c. Application thread reply check
    const isThreadReply =
      /^(?:\[?re\]?:\s*)/i.test(subject) &&
      (/\b(?:application|job|role|developer|intern|resume|cv|hiring|interview|cft)\b/i.test(
        subject,
      ) ||
        hasApplicationPhrasing);

    if (isThreadReply) {
      matchedIndicators.push('THREAD_REPLY_APPLICATION');
    }

    // 2d. Role detection from subject/body against configured vacancies
    const roleResolution = this.roleDetectionService.detectRole({
      subject,
      body,
      senderName: message.sender?.name,
      senderEmail: message.sender?.email,
    });

    const hasConfiguredRole =
      roleResolution.status === 'RESOLVED' &&
      roleResolution.canonicalRole !== null;

    if (hasConfiguredRole) {
      matchedIndicators.push('CONFIGURED_ROLE_MATCH');
    }

    // 2e. Minimal or unusual subjects (e.g. "CV", "Resume", "John Doe", "Application")
    const isMinimalSubject =
      /^(?:cv|resume|job application|application|candidacy|curriculum vitae|my cv|my resume)(?:\s*[-–|:]\s*[\w\s]+)?$/i.test(
        normSubject.trim(),
      );

    if (isMinimalSubject) {
      matchedIndicators.push('MINIMAL_SUBJECT_APPLICATION');
    }

    // Step 3: Check attachments
    const resumeAttachments = attachments.filter((att) =>
      this.isPotentialResumeAttachment(att),
    );
    const hasResumeAttachment = resumeAttachments.length > 0;

    const resumeFilenameIndicators = resumeAttachments.some((a) =>
      /\b(?:resume|cv|biodata|profile|curriculum)\b/i.test(a.filename || ''),
    );
    if (resumeFilenameIndicators) {
      matchedIndicators.push('RESUME_FILENAME_MATCH');
    }

    // Step 4: Decision synthesis

    // Case A: Clear recruitment match
    // Has resume attachment AND (strong application phrasing OR configured role OR forwarded/reply recruitment OR minimal subject)
    const isClearRecruitmentIntent =
      hasApplicationPhrasing ||
      (hasConfiguredRole && (hasResumeAttachment || isMinimalSubject)) ||
      (isForwarded && (hasResumeAttachment || hasApplicationPhrasing)) ||
      (isThreadReply && (hasResumeAttachment || hasApplicationPhrasing)) ||
      (isMinimalSubject && hasResumeAttachment);

    if (isClearRecruitmentIntent && hasResumeAttachment) {
      matchedIndicators.push('RECRUITMENT_MATCH');
      return {
        decision: 'RECRUITMENT_APPLICATION',
        auditReason: 'RECRUITMENT_MATCH',
        confidence: 'HIGH',
        detectedRole: roleResolution.detectedRole,
        canonicalRole: roleResolution.canonicalRole || undefined,
        matchedIndicators,
        explanation:
          'Valid recruitment application confirmed with candidate intent and valid resume attachment',
      };
    }

    // Case B: Clear application intent, but NO supported PDF/DOCX attachment
    if (isClearRecruitmentIntent && !hasResumeAttachment) {
      matchedIndicators.push('UNSUPPORTED_ATTACHMENT');
      return {
        decision: 'UNSUPPORTED_ATTACHMENT',
        auditReason: 'UNSUPPORTED_ATTACHMENT',
        confidence: 'HIGH',
        detectedRole: roleResolution.detectedRole,
        canonicalRole: roleResolution.canonicalRole || undefined,
        matchedIndicators,
        rejectionReason:
          'Candidate application language detected, but no valid PDF or DOCX resume attachment was provided',
        explanation:
          'Email contains recruitment intent but lacks a supported resume file (PDF or DOCX)',
      };
    }

    // Case C: Ambiguous message
    // Has a PDF or DOCX attachment, but lacks explicit application phrasing or known role,
    // while not matching clean exclusions (e.g. general business inquiry or vague message).
    // Or isolated keywords like "developer" / "candidate" without application phrasing.
    const hasIsolatedKeywords =
      /\b(?:developer|candidate|interview|hiring|profile)\b/i.test(
        combinedText,
      );

    if (hasResumeAttachment && (hasIsolatedKeywords || normBody.length > 20)) {
      matchedIndicators.push('AMBIGUOUS_EVIDENCE');
      return {
        decision: 'AMBIGUOUS',
        auditReason: 'AMBIGUOUS_EMAIL',
        confidence: 'LOW',
        matchedIndicators,
        rejectionReason:
          'Email contains attachment and potential keywords but lacks explicit job application intent',
        explanation:
          'Ambiguous email routed to manual review state without automated candidate creation',
      };
    }

    // Case D: General correspondence / unrelated email
    matchedIndicators.push('NO_APPLICATION_CONTEXT');
    return {
      decision: 'UNRELATED_EMAIL',
      auditReason: 'NO_APPLICATION_CONTEXT',
      confidence: 'HIGH',
      matchedIndicators,
      rejectionReason:
        'No candidate application language, vacancy role, or valid resume attachment found',
      explanation:
        'General correspondence or unrelated email skipped without processing',
    };
  }

  /**
   * Persists ambiguous email metadata to Redis review state without exposing sensitive body text.
   */
  public async recordAmbiguousReview(
    message: GmailMessageDetail,
    result: EmailClassificationResult,
  ): Promise<void> {
    const record: AmbiguousReviewRecord = {
      messageId: message.id,
      threadId: message.threadId,
      subjectSnippet: this.sanitizeSnippet(message.subject),
      senderDomain: this.extractSenderDomain(message.sender?.email),
      receivedDate: message.receivedDate
        ? new Date(message.receivedDate).toISOString()
        : new Date().toISOString(),
      auditReason: result.auditReason,
      matchedIndicators: result.matchedIndicators,
      explanation: result.explanation,
      createdAt: new Date().toISOString(),
    };

    this.logger.warn(
      `Ambiguous recruitment email placed in review state: "${record.subjectSnippet}" (ID: ${record.messageId})`,
      {
        messageId: record.messageId,
        auditReason: record.auditReason,
        senderDomain: record.senderDomain,
        matchedIndicators: record.matchedIndicators,
      },
    );

    if (this.redisService?.client) {
      try {
        await this.redisService.client.hset(
          RecruitmentEmailClassifierService.AMBIGUOUS_SET_KEY,
          message.id,
          JSON.stringify(record),
        );
      } catch (err: any) {
        this.logger.error(
          'Failed to store ambiguous email review record in Redis',
          {
            messageId: message.id,
            cause: err.message,
          },
        );
      }
    }
  }

  /**
   * Retrieves pending ambiguous email review records from Redis.
   */
  public async getAmbiguousReviews(): Promise<AmbiguousReviewRecord[]> {
    if (!this.redisService?.client) {
      return [];
    }

    try {
      const records = await this.redisService.client.hgetall(
        RecruitmentEmailClassifierService.AMBIGUOUS_SET_KEY,
      );
      return Object.values(records).map((raw) => JSON.parse(raw));
    } catch (err: any) {
      this.logger.error(
        'Failed to retrieve ambiguous email review records from Redis',
        {
          cause: err.message,
        },
      );
      return [];
    }
  }
}
