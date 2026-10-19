import axios from 'axios';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BaseService } from '@Common';
import { gmailConfigFactory } from '@Config';
import { RedisService } from '../redis';
import { GeminiService } from './gemini.service';
import { ResumeFingerprintService } from './resume-fingerprint.service';
import { CandidateService } from '../candidate/candidate.service';
import {
  GmailAttachmentMeta,
  GmailConnectionStatus,
  GmailListResponse,
  GmailMessageDetail,
  GmailMessageSender,
  ResumeExtractionResult,
} from './gmail.types';
import { ResumeAnalysisResult } from './gemini.types';
import { MailService } from './mail.service';
import { ResumeScreeningQueueService } from './resume-screening-queue.service';
import { ResumeScreeningWorkerService } from './resume-screening-worker.service';
import { RoleDetectionService } from './role-detection.service';

@Injectable()
export class GmailService extends BaseService {
  private cachedAccessToken: string | null = null;
  private tokenExpiresAt = 0;
  private isPolling = false;
  private readonly roleDetectionService: RoleDetectionService;

  private static readonly PROCESSED_SET_KEY = 'gmail:processed_messages';
  private static readonly GMAIL_API_BASE =
    'https://gmail.googleapis.com/gmail/v1/users';

  constructor(
    @Inject(gmailConfigFactory.KEY)
    private readonly config: ConfigType<typeof gmailConfigFactory>,
    private readonly redisService: RedisService,
    private readonly geminiService: GeminiService,
    private readonly resumeFingerprintService: ResumeFingerprintService,
    @Optional()
    @Inject(forwardRef(() => CandidateService))
    private readonly candidateService?: CandidateService,
    @Optional()
    @Inject(forwardRef(() => MailService))
    private readonly mailService?: MailService,
    @Optional()
    private readonly queueService?: ResumeScreeningQueueService,
    @Optional()
    private readonly workerService?: ResumeScreeningWorkerService,
    @Optional()
    roleDetectionService?: RoleDetectionService,
  ) {
    super({ loggerDefaultMeta: { service: GmailService.name } });
    this.roleDetectionService =
      roleDetectionService || new RoleDetectionService();
  }

  /**
   * Validates if required Google OAuth2 credentials exist in environment config.
   */
  isConfigured(): boolean {
    return Boolean(
      this.config.clientId &&
      this.config.clientSecret &&
      this.config.refreshToken,
    );
  }

  /**
   * Retrieves or refreshes Google OAuth2 access token.
   */
  async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error(
        'Gmail OAuth2 credentials (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN) are not configured',
      );
    }

    // Return cached token if valid (with 60-second buffer before expiry)
    if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.cachedAccessToken;
    }

    try {
      this.logger.info('Refreshing Gmail OAuth2 access token...');
      const response = await axios.post<{
        access_token: string;
        expires_in: number;
        token_type: string;
      }>(
        'https://oauth2.googleapis.com/token',
        {
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: this.config.refreshToken,
          grant_type: 'refresh_token',
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        },
      );

      this.cachedAccessToken = response.data.access_token;
      this.tokenExpiresAt =
        Date.now() + (response.data.expires_in || 3600) * 1000;

      return this.cachedAccessToken;
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.error_description ||
        err.response?.data?.error ||
        err.message ||
        'Failed to refresh Gmail access token';
      this.logger.error('Gmail OAuth2 token refresh failed', {
        cause: errorMsg,
      });
      throw new Error(`Gmail authorization error: ${errorMsg}`);
    }
  }

  /**
   * Returns current connection and authorization status safely.
   */
  async getStatus(): Promise<GmailConnectionStatus> {
    const configured = this.isConfigured();
    const status: GmailConnectionStatus = {
      configured,
      user: this.config.user,
      searchFilter: this.config.searchQuery,
      pollingEnabled: this.config.pollingEnabled,
      maxAttachmentSize: this.config.maxAttachmentSize,
    };

    if (!configured) {
      status.error =
        'Missing Gmail OAuth credentials. Ensure GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN are provided in .env';
      return status;
    }

    try {
      await this.getAccessToken();
    } catch (err: any) {
      status.error = err.message;
    }

    return status;
  }

  /**
   * Decodes Base64URL string returned by Gmail API.
   */
  private decodeBase64Url(data?: string): string {
    if (!data) return '';
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  /**
   * Parses standard email From header into name and email.
   */
  private parseSender(fromHeader?: string): GmailMessageSender {
    if (!fromHeader) return { email: '' };

    const match = fromHeader.match(
      /^(?:(.*?)<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?$/,
    );
    if (match) {
      const name = match[1]?.trim().replace(/^["']|["']$/g, '');
      return {
        name: name || undefined,
        email: match[2]?.trim().toLowerCase(),
      };
    }
    return { email: fromHeader.trim().toLowerCase() };
  }

  /**
   * Recursively parses email payload to extract text, HTML, and attachment metadata.
   */
  private extractParts(payload: any): {
    textBody?: string;
    htmlBody?: string;
    attachments: GmailAttachmentMeta[];
  } {
    let textBody = '';
    let htmlBody = '';
    const attachments: GmailAttachmentMeta[] = [];

    const traverse = (part: any) => {
      if (!part) return;

      const mimeType = part.mimeType || '';
      const filename = part.filename || '';
      const body = part.body || {};

      if (filename && filename.length > 0) {
        attachments.push({
          filename,
          mimeType,
          size: body.size || 0,
          attachmentId: body.attachmentId,
        });
      } else if (mimeType === 'text/plain' && body.data) {
        textBody += (textBody ? '\n' : '') + this.decodeBase64Url(body.data);
      } else if (mimeType === 'text/html' && body.data) {
        htmlBody += (htmlBody ? '\n' : '') + this.decodeBase64Url(body.data);
      }

      if (Array.isArray(part.parts)) {
        part.parts.forEach(traverse);
      }
    };

    traverse(payload);

    return {
      textBody: textBody.trim() || undefined,
      htmlBody: htmlBody.trim() || undefined,
      attachments,
    };
  }

  /**
   * Lists message IDs matching query from Gmail.
   */
  async listMessages(options?: {
    query?: string;
    maxResults?: number;
    pageToken?: string;
  }): Promise<GmailListResponse> {
    const accessToken = await this.getAccessToken();
    const query = options?.query ?? this.config.searchQuery;
    const maxResults = options?.maxResults ?? 10;

    try {
      const response = await axios.get<{
        messages?: Array<{ id: string; threadId: string }>;
        nextPageToken?: string;
        resultSizeEstimate?: number;
      }>(`${GmailService.GMAIL_API_BASE}/${this.config.user}/messages`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          q: query,
          maxResults,
          pageToken: options?.pageToken,
        },
        timeout: 15000,
      });

      return {
        messages: response.data.messages || [],
        nextPageToken: response.data.nextPageToken,
        resultSizeEstimate: response.data.resultSizeEstimate,
      };
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to list Gmail messages';
      this.logger.error('Error listing Gmail messages', { cause: errorMsg });
      throw new Error(`Gmail API error: ${errorMsg}`);
    }
  }

  /**
   * Retrieves and parses a single Gmail message by ID.
   */
  async getMessage(id: string): Promise<GmailMessageDetail> {
    const accessToken = await this.getAccessToken();

    try {
      const response = await axios.get<any>(
        `${GmailService.GMAIL_API_BASE}/${this.config.user}/messages/${id}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: { format: 'full' },
          timeout: 15000,
        },
      );

      const msg = response.data;
      const headers: Array<{ name: string; value: string }> =
        msg.payload?.headers || [];

      const getHeader = (name: string): string =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
          ?.value || '';

      const from = getHeader('from');
      const to = getHeader('to');
      const subject = getHeader('subject');
      const dateHeader = getHeader('date');

      const parsedSender = this.parseSender(from);
      const { textBody, htmlBody, attachments } = this.extractParts(
        msg.payload,
      );

      return {
        id: msg.id,
        threadId: msg.threadId,
        sender: parsedSender,
        recipient: to,
        subject,
        receivedDate: dateHeader
          ? new Date(dateHeader)
          : new Date(Number(msg.internalDate)),
        snippet: msg.snippet || '',
        textBody,
        htmlBody,
        attachments,
      };
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.error?.message ||
        err.message ||
        `Failed to retrieve Gmail message ${id}`;
      this.logger.error('Error retrieving Gmail message', {
        id,
        cause: errorMsg,
      });
      throw new Error(`Gmail API error: ${errorMsg}`);
    }
  }

  /**
   * Downloads raw attachment bytes from Gmail API using messageId and attachmentId.
   */
  async downloadAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    const accessToken = await this.getAccessToken();

    try {
      const response = await axios.get<{ size: number; data: string }>(
        `${GmailService.GMAIL_API_BASE}/${this.config.user}/messages/${messageId}/attachments/${attachmentId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 30000,
        },
      );

      const base64Data = response.data?.data;
      if (!base64Data) {
        throw new Error('Empty attachment payload received from Gmail API');
      }

      const buffer = Buffer.from(
        base64Data.replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      );

      if (buffer.length > this.config.maxAttachmentSize) {
        throw new Error(
          `Attachment exceeds maximum allowed size of ${this.config.maxAttachmentSize} bytes (received ${buffer.length} bytes)`,
        );
      }

      this.logger.info('Downloaded attachment successfully', {
        messageId,
        attachmentId,
        bytesDownloaded: buffer.length,
      });

      return buffer;
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.error?.message ||
        err.message ||
        `Failed to download attachment ${attachmentId}`;
      this.logger.error('Attachment download failed', {
        messageId,
        attachmentId,
        cause: errorMsg,
      });
      throw new Error(`Attachment download error: ${errorMsg}`);
    }
  }

  /**
   * Determines if a file is a potential resume based on extension or MIME type.
   */
  private isResumeCandidate(filename: string, mimeType: string): boolean {
    const lowerName = (filename || '').toLowerCase();
    const lowerMime = (mimeType || '').toLowerCase();

    return (
      lowerName.endsWith('.pdf') ||
      lowerName.endsWith('.docx') ||
      lowerMime === 'application/pdf' ||
      lowerMime ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  }

  /**
   * Extracts readable text from a PDF or DOCX buffer after verifying magic bytes.
   */
  async extractResumeText(
    buffer: Buffer,
  ): Promise<{ text?: string; error?: string }> {
    if (!buffer || buffer.length === 0) {
      return { error: 'Attachment file is empty (0 bytes)' };
    }

    if (buffer.length > this.config.maxAttachmentSize) {
      return {
        error: `Attachment size (${buffer.length} bytes) exceeds limit (${this.config.maxAttachmentSize} bytes)`,
      };
    }

    // Inspect magic bytes:
    // PDF magic bytes: starts with '%PDF-' (0x25 0x50 0x44 0x46 0x2D)
    const isPdf =
      buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';

    // DOCX magic bytes: ZIP header PK\x03\x04 (0x50 0x4B 0x03 0x04)
    const isDocx =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04;

    if (!isPdf && !isDocx) {
      return {
        error:
          'Unsupported file format or invalid file signature: file contents do not match PDF or DOCX format',
      };
    }

    if (isPdf) {
      const parser = new PDFParse({ data: buffer });
      let text: string | undefined;
      let parseError: string | undefined;

      try {
        const parsed = await parser.getText();
        text = parsed.text?.trim();
      } catch (err: any) {
        parseError = err.message;
      } finally {
        await parser.destroy().catch(() => {});
      }

      const isInsufficient = !text || this.isSuspiciouslyShortText(text);

      if (isInsufficient) {
        this.logger.info(
          `Local PDF parser produced insufficient text (${text?.length || 0} chars); attempting OCR extraction for scanned document`,
          {
            charsExtracted: text?.length || 0,
            preview: text ? text.slice(0, 50) : null,
            parseError,
          },
        );

        if (
          this.geminiService &&
          typeof this.geminiService.extractTextWithOcr === 'function' &&
          this.geminiService.isConfigured()
        ) {
          try {
            const ocrResult = await this.geminiService.extractTextWithOcr(
              buffer,
              'application/pdf',
            );
            if (
              ocrResult.text &&
              !this.isSuspiciouslyShortText(ocrResult.text)
            ) {
              this.logger.info(
                `OCR extraction succeeded (${ocrResult.text.length} chars extracted)`,
              );
              return { text: ocrResult.text };
            }
          } catch (ocrErr: any) {
            this.logger.warn(`OCR extraction failed: ${ocrErr.message}`);
          }
        }

        return {
          error:
            'RESUME_EXTRACTION_INSUFFICIENT: Document contains no readable text or insufficient text to evaluate (scanned image or empty document)',
        };
      }

      return { text };
    } else {
      // DOCX format
      try {
        const parsed = await mammoth.extractRawText({ buffer });
        const text = parsed.value?.trim();

        const isInsufficient = !text || this.isSuspiciouslyShortText(text);

        if (isInsufficient) {
          return {
            error:
              'RESUME_EXTRACTION_INSUFFICIENT: Document contains no readable text or insufficient text to evaluate',
          };
        }

        return { text };
      } catch (err: any) {
        return {
          error: `Corrupted or unreadable DOCX document: ${err.message}`,
        };
      }
    }
  }

  /**
   * Delegates or checks for empty/suspiciously short text.
   */
  public isSuspiciouslyShortText(text?: string | null): boolean {
    if (!text) return true;
    if (
      this.geminiService &&
      typeof this.geminiService.isSuspiciouslyShortText === 'function'
    ) {
      return this.geminiService.isSuspiciouslyShortText(text);
    }
    const trimmed = text.trim();
    if (trimmed.length < 80) return true;
    const isFooterOnly =
      /^(--\s*\d+\s*of\s*\d+\s*--|page\s*\d+(\s*of\s*\d+)?|\d+\s*\/\s*\d+)$/i.test(
        trimmed,
      );
    if (isFooterOnly) return true;
    const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
    return words.length < 15;
  }

  /**
   * Processes a single attachment: validates format, downloads, and extracts text.
   */
  async extractAttachmentResume(
    messageId: string,
    attachment: GmailAttachmentMeta,
  ): Promise<ResumeExtractionResult> {
    const { filename, mimeType, size, attachmentId } = attachment;

    // Check candidate format
    if (!this.isResumeCandidate(filename, mimeType)) {
      return {
        attachmentId,
        filename,
        mimeType,
        size,
        status: 'skipped',
        error: 'Non-resume file format skipped',
      };
    }

    if (!attachmentId) {
      return {
        filename,
        mimeType,
        size,
        status: 'failed',
        error: 'Missing attachment ID from message metadata',
      };
    }

    // Check size limit prior to download
    if (size > this.config.maxAttachmentSize) {
      return {
        attachmentId,
        filename,
        mimeType,
        size,
        status: 'failed',
        error: `File size (${size} bytes) exceeds limit (${this.config.maxAttachmentSize} bytes)`,
      };
    }

    try {
      const buffer = await this.downloadAttachment(messageId, attachmentId);
      const fingerprint =
        this.resumeFingerprintService.computeFingerprint(buffer);

      // Check if resume content was already processed: skip PDF/DOCX parsing entirely
      const isAlreadyProcessed =
        await this.resumeFingerprintService.isFingerprintProcessed(fingerprint);
      if (isAlreadyProcessed) {
        this.logger.info(
          `Duplicate resume skipped; fingerprint already processed`,
          {
            messageId,
            attachmentId,
            filename,
            fingerprint,
          },
        );
        return {
          attachmentId,
          filename,
          mimeType,
          size: buffer.length,
          status: 'skipped',
          isDuplicate: true,
          fingerprint,
          error: 'Duplicate resume skipped; fingerprint already processed',
        };
      }

      // Check if resume text is already durably retained in screening queue
      if (this.queueService) {
        const existingJob = await this.queueService.getJob(fingerprint);
        if (existingJob) {
          if (existingJob.status === 'COMPLETED') {
            return {
              attachmentId,
              filename,
              mimeType,
              size: buffer.length,
              status: 'skipped',
              isDuplicate: true,
              fingerprint,
              error: 'Duplicate resume skipped; fingerprint already completed',
            };
          }

          if (
            existingJob.extractedResumeText &&
            existingJob.extractedResumeText.trim().length > 0
          ) {
            this.logger.info(
              'Using durable extracted resume text from screening queue; skipping duplicate PDF/DOCX parsing',
              { messageId, attachmentId, fingerprint },
            );
            return {
              attachmentId,
              filename,
              mimeType,
              size: buffer.length,
              status: 'success',
              text: existingJob.extractedResumeText,
              fingerprint,
            };
          }
        }
      }

      // Concurrency check: acquire distributed lock to avoid concurrent processing
      const lock =
        await this.resumeFingerprintService.acquireProcessingLock(fingerprint);
      if (!lock.acquired) {
        this.logger.warn(
          `Resume is currently being processed by another worker; skipping concurrent execution`,
          {
            messageId,
            attachmentId,
            filename,
            fingerprint,
          },
        );
        return {
          attachmentId,
          filename,
          mimeType,
          size: buffer.length,
          status: 'skipped',
          isDuplicate: true,
          fingerprint,
          error: 'Resume is currently being processed by another worker',
        };
      }

      const extraction = await this.extractResumeText(buffer);

      if (extraction.error) {
        await this.resumeFingerprintService.releaseProcessingLock(
          fingerprint,
          lock.lockToken,
        );
        return {
          attachmentId,
          filename,
          mimeType,
          size: buffer.length,
          status: 'failed',
          fingerprint,
          error: extraction.error,
        };
      }

      this.logger.info('Extracted resume text successfully', {
        messageId,
        attachmentId,
        filename,
        charactersExtracted: extraction.text!.length,
        fingerprint,
      });

      return {
        attachmentId,
        filename,
        mimeType,
        size: buffer.length,
        status: 'success',
        text: extraction.text,
        fingerprint,
        lockToken: lock.lockToken,
      };
    } catch (err: any) {
      return {
        attachmentId,
        filename,
        mimeType,
        size,
        status: 'failed',
        error: `Attachment download error: ${err.message}`,
      };
    }
  }

  /**
   * Processes all attachments of a message independently.
   * Returns whether any attachment suffered a transient download failure.
   */
  async processMessageResumes(
    messageId: string,
    attachments: GmailAttachmentMeta[],
  ): Promise<{
    resumes: ResumeExtractionResult[];
    hasDownloadFailure: boolean;
  }> {
    const resumes: ResumeExtractionResult[] = [];
    let hasDownloadFailure = false;

    for (const att of attachments) {
      const result = await this.extractAttachmentResume(messageId, att);
      resumes.push(result);

      // Distinguish transient download/network failures from permanent document errors
      if (
        result.status === 'failed' &&
        result.error?.includes('Attachment download error')
      ) {
        hasDownloadFailure = true;
      }
    }

    return { resumes, hasDownloadFailure };
  }

  /**
   * Checks whether a Gmail message has already been processed using Redis Set.
   */
  async isMessageProcessed(messageId: string): Promise<boolean> {
    try {
      const isMember = await this.redisService.client.sismember(
        GmailService.PROCESSED_SET_KEY,
        messageId,
      );
      return isMember === 1;
    } catch (err: any) {
      this.logger.error('Failed to check Redis message processed status', {
        messageId,
        cause: err.message,
      });
      return false;
    }
  }

  /**
   * Marks a Gmail message as processed in Redis.
   */
  async markMessageProcessed(messageId: string): Promise<void> {
    try {
      await this.redisService.client.sadd(
        GmailService.PROCESSED_SET_KEY,
        messageId,
      );
    } catch (err: any) {
      this.logger.error('Failed to mark message as processed in Redis', {
        messageId,
        cause: err.message,
      });
    }
  }

  /**
   * Analyzes an application message using Google Gemini.
   * If valid resumes are present, each is analyzed independently preserving attachment association.
   * If no valid resume exists, analyzes the email content explicitly and flags missing resume.
   */
  async analyzeMessageWithGemini(messageDetail: GmailMessageDetail): Promise<{
    analyses: ResumeAnalysisResult[];
    hasAnalysisFailure: boolean;
  }> {
    if (!this.geminiService.isConfigured()) {
      this.logger.warn(
        'Google Gemini analysis skipped: GEMINI_API_KEY is not configured',
        { messageId: messageDetail.id },
      );
      return { analyses: [], hasAnalysisFailure: false };
    }

    const analyses: ResumeAnalysisResult[] = [];
    let hasAnalysisFailure = false;

    // Filter resumes extracted with readable text that are NOT duplicates
    const successfulResumes = (messageDetail.resumes || []).filter(
      (r) =>
        r.status === 'success' &&
        !r.isDuplicate &&
        r.text &&
        r.text.trim().length > 0,
    );

    const candidateResumes =
      successfulResumes.length > 0
        ? successfulResumes
        : (messageDetail.resumes || []).filter(
            (r) =>
              !r.isDuplicate &&
              r.error?.includes('RESUME_EXTRACTION_INSUFFICIENT'),
          );

    if (candidateResumes.length > 0) {
      const roleResolution = this.roleDetectionService.detectRole({
        subject: messageDetail.subject,
        body: messageDetail.textBody || messageDetail.snippet,
        senderName: messageDetail.sender?.name,
        senderEmail: messageDetail.sender?.email,
      });

      for (const resume of candidateResumes) {
        const result = await this.geminiService.analyzeApplication({
          messageId: messageDetail.id,
          subject: messageDetail.subject,
          sender: messageDetail.sender,
          recipient: messageDetail.recipient,
          receivedDate: messageDetail.receivedDate,
          emailBody: messageDetail.textBody || messageDetail.snippet,
          resumeText: resume.text || '',
          filename: resume.filename,
          attachmentId: resume.attachmentId,
          jobRole:
            roleResolution.status === 'RESOLVED'
              ? roleResolution.detectedRole
              : undefined,
        });

        result.fingerprint = resume.fingerprint;
        result.lockToken = resume.lockToken;

        analyses.push(result);
        if (result.status === 'failed') {
          hasAnalysisFailure = true;
          if (resume.fingerprint) {
            await this.resumeFingerprintService.releaseProcessingLock(
              resume.fingerprint,
              resume.lockToken,
            );
          }
        }
      }
    } else {
      this.logger.info(
        'Skipping Google Gemini analysis: message contains no readable resume attachments (PDF/DOCX)',
        { messageId: messageDetail.id },
      );
    }

    return { analyses, hasAnalysisFailure };
  }

  /**
   * Fetches new (unprocessed) emails matching recruitment search query,
   * downloads and extracts resume attachments, performs Google Gemini analysis,
   * and only marks the message as processed in Redis if all downloads and
   * analyses succeed (allowing retries on transient failures).
   */
  async fetchNewApplications(options?: {
    query?: string;
    maxResults?: number;
    analyzeWithGemini?: boolean;
  }): Promise<GmailMessageDetail[]> {
    const listResult = await this.listMessages(options);

    if (!listResult.messages.length) {
      return [];
    }

    const newMessages: GmailMessageDetail[] = [];
    const shouldAnalyzeWithGemini =
      options?.analyzeWithGemini ?? this.geminiService.isConfigured();

    for (const item of listResult.messages) {
      const alreadyProcessed = await this.isMessageProcessed(item.id);
      if (alreadyProcessed) {
        continue;
      }

      try {
        const messageDetail = await this.getMessage(item.id);

        // Pre-filter: Check if message contains any potential resume attachments (PDF or DOCX)
        const hasResumeAttachment = (messageDetail.attachments || []).some(
          (att) => this.isResumeCandidate(att.filename, att.mimeType),
        );

        if (!hasResumeAttachment) {
          this.logger.info(
            `Skipping non-recruitment email "${messageDetail.subject}" (ID: ${messageDetail.id}): No resume attachments (PDF/DOCX) detected`,
            {
              messageId: item.id,
              sender: messageDetail.sender?.email,
            },
          );
          // Mark as processed in Redis to avoid re-evaluating ordinary notifications on every poll
          await this.markMessageProcessed(item.id);
          // Do not push non-recruitment email to newMessages counter
          continue;
        }

        // 1. Process attachments independently
        const { resumes, hasDownloadFailure } =
          await this.processMessageResumes(item.id, messageDetail.attachments);
        messageDetail.resumes = resumes;

        const validResumes = resumes.filter(
          (r) =>
            !r.isDuplicate &&
            ((r.status === 'success' && r.text && r.text.trim().length > 0) ||
              r.error?.includes('RESUME_EXTRACTION_INSUFFICIENT')),
        );

        // If no valid new resumes extracted (e.g. all attachments were duplicates or non-resumes)
        if (validResumes.length === 0) {
          if (!hasDownloadFailure) {
            await this.markMessageProcessed(item.id);
          }
          // Do not count as new applications if all attachments are duplicates or non-resumes
          continue;
        }

        // 2. Queue and execute screening
        if (this.queueService && this.workerService) {
          const roleResolution = this.roleDetectionService.detectRole({
            subject: messageDetail.subject,
            body: messageDetail.textBody || messageDetail.snippet,
            senderName: messageDetail.sender?.name,
            senderEmail: messageDetail.sender?.email,
          });

          for (const resume of validResumes) {
            const job = await this.queueService.enqueueJob({
              fingerprint: resume.fingerprint!,
              messageId: item.id,
              attachmentId: resume.attachmentId!,
              filename: resume.filename,
              mimeType: resume.mimeType,
              fileSize: resume.size,
              sender: messageDetail.sender,
              subject: messageDetail.subject,
              receivedDate: messageDetail.receivedDate,
              emailBody: messageDetail.textBody || messageDetail.snippet,
              extractedResumeText: resume.text || '',
              jobRole:
                roleResolution.status === 'RESOLVED'
                  ? roleResolution.detectedRole
                  : undefined,
            });

            if (shouldAnalyzeWithGemini) {
              const processedJob =
                await this.workerService.processSingleJob(job);
              if (processedJob.status === 'RETRY_WAIT') {
                this.logger.info(
                  `Resume screening job ${job.id} enqueued in durable retry state (RETRY_WAIT); Gmail message marked processed`,
                  {
                    messageId: item.id,
                    jobId: job.id,
                    nextRetryAt: new Date(
                      processedJob.nextRetryAt,
                    ).toISOString(),
                  },
                );
              }
            }
          }

          // Mark message processed since jobs are safely persisted in durable queue
          if (!hasDownloadFailure) {
            await this.markMessageProcessed(item.id);
          }
          newMessages.push(messageDetail);
        } else {
          // Fallback if queue service not injected (e.g. in isolated unit tests)
          let hasAnalysisFailure = false;
          let hasPersistenceFailure = false;
          if (shouldAnalyzeWithGemini) {
            const { analyses, hasAnalysisFailure: analysisFailed } =
              await this.analyzeMessageWithGemini(messageDetail);
            messageDetail.analyses = analyses;
            hasAnalysisFailure = analysisFailed;

            if (this.candidateService && analyses.length > 0) {
              for (const analysis of analyses) {
                if (analysis.status === 'success' && analysis.attachmentId) {
                  try {
                    await this.candidateService.persistAndProcessScreeningResult(
                      {
                        messageDetail,
                        analysisResult: analysis,
                      },
                    );
                  } catch (persistErr: any) {
                    hasPersistenceFailure = true;
                    this.logger.error(
                      'Failed to persist candidate screening result to Excel',
                      {
                        messageId: item.id,
                        attachmentId: analysis.attachmentId,
                        cause: persistErr.message,
                      },
                    );
                    if (analysis.fingerprint) {
                      await this.resumeFingerprintService.releaseProcessingLock(
                        analysis.fingerprint,
                        analysis.lockToken,
                      );
                    }
                  }
                }
              }
            }
          }

          if (
            hasDownloadFailure ||
            hasAnalysisFailure ||
            hasPersistenceFailure
          ) {
            this.logger.warn(
              'Skipping Redis processed status mark due to attachment download, Gemini analysis, or Excel persistence failure - will retry on next poll',
              {
                messageId: item.id,
                hasDownloadFailure,
                hasAnalysisFailure,
                hasPersistenceFailure,
              },
            );
          } else {
            await this.markMessageProcessed(item.id);
          }

          newMessages.push(messageDetail);
        }
      } catch (err: any) {
        this.logger.error('Failed to process message detail', {
          id: item.id,
          cause: err.message,
        });
      }
    }

    return newMessages;
  }

  /**
   * Scheduled cron task running every minute (or configured interval).
   * Guarded against concurrent runs with concurrency lock.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async pollInbox(): Promise<void> {
    if (!this.config.pollingEnabled) {
      return;
    }

    if (!this.isConfigured()) {
      return;
    }

    if (this.isPolling) {
      this.logger.warn(
        'Recruitment automation check skipped: previous run is still in progress',
      );
      return;
    }

    this.isPolling = true;
    this.logger.info(
      'Recruitment automation check started: checking Gmail inbox for new internship applications...',
    );

    try {
      const applications = await this.fetchNewApplications({
        query: this.config.searchQuery,
      });

      this.logger.info('Recruitment automation check completed', {
        newApplicationsDetected: applications.length,
      });
    } catch (err: any) {
      this.logger.error('Recruitment automation check failed', {
        cause: err.message,
      });
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Sends an email using configured Gmail service (OAuth2 API or MailService SMTP fallback).
   */
  async sendEmail(options: {
    to: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
  }): Promise<{
    messageId?: string;
    status: 'SENT' | 'FAILED';
    error?: string;
  }> {
    const sender =
      process.env.SMTP_SENDER ||
      (this.config.user && this.config.user !== 'me'
        ? this.config.user
        : undefined) ||
      'recruitment@codesfortomorrow.com';

    if (this.isConfigured()) {
      try {
        const accessToken = await this.getAccessToken();
        const utf8Subject = `=?utf-8?B?${Buffer.from(options.subject).toString('base64')}?=`;
        const emailLines = [
          `From: ${sender}`,
          `To: ${options.to}`,
          `Subject: ${utf8Subject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=utf-8',
          '',
          options.bodyText,
        ];
        const emailRaw = Buffer.from(emailLines.join('\r\n'))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const url = `${GmailService.GMAIL_API_BASE}/${encodeURIComponent(this.config.user || 'me')}/messages/send`;
        const res = await axios.post<{ id: string; threadId: string }>(
          url,
          { raw: emailRaw },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );

        this.logger.info(`Email sent via Gmail API to ${options.to}`, {
          messageId: res.data?.id,
        });

        return { messageId: res.data?.id, status: 'SENT' };
      } catch (gmailErr: any) {
        this.logger.warn(
          `Gmail API send failed: ${gmailErr.message}; attempting SMTP fallback`,
        );
      }
    }

    if (this.mailService) {
      try {
        const result = await this.mailService.sendDirect({
          to: options.to,
          subject: options.subject,
          text: options.bodyText,
          html: options.bodyHtml || options.bodyText.replace(/\n/g, '<br/>'),
        });

        this.logger.info(`Email sent via MailService SMTP to ${options.to}`, {
          messageId: (result as any)?.messageId,
        });

        return { messageId: (result as any)?.messageId, status: 'SENT' };
      } catch (smtpErr: any) {
        this.logger.error(`MailService sendDirect failed: ${smtpErr.message}`);
        return { status: 'FAILED', error: smtpErr.message };
      }
    }

    return {
      status: 'FAILED',
      error:
        'Neither Gmail OAuth2 credentials nor SMTP configuration is active',
    };
  }
}
