import { GoogleGenAI, Type } from '@google/genai';
import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { BaseService } from '@Common';
import { geminiConfigFactory } from '@Config';
import { RedisService } from '../redis';
import {
  AnalyzeApplicationInput,
  CandidateApplicationAnalysis,
  ResumeAnalysisResult,
  validateApplicationAnalysis,
} from './gemini.types';
import {
  classifyGeminiError,
  calculateBackoffWithJitter,
  GeminiPermanentException,
  GeminiTransientException,
} from './gemini-error.classifier';
import { JobRoleDefinition } from '../configs/job-roles.config';
import { RoleScoringEngine } from './role-scoring-engine';
import { RoleDetectionService } from './role-detection.service';

@Injectable()
export class GeminiService extends BaseService implements OnModuleInit {
  private static readonly ANALYSIS_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
  private geminiClient: GoogleGenAI | null = null;

  constructor(
    @Inject(geminiConfigFactory.KEY)
    private readonly config: ConfigType<typeof geminiConfigFactory>,
    private readonly redisService: RedisService,
    @Optional()
    private readonly roleDetectionService?: RoleDetectionService,
  ) {
    super({ loggerDefaultMeta: { service: GeminiService.name } });
  }

  private getRoleDetector(): RoleDetectionService {
    return this.roleDetectionService || new RoleDetectionService();
  }

  /**
   * Validates configuration at application startup.
   * Logs a warning if API key is missing without crashing unrelated services.
   */
  onModuleInit(): void {
    if (!this.isConfigured()) {
      this.logger.warn(
        'Google Gemini API key is not configured (GEMINI_API_KEY is missing). AI resume analysis will fallback to the built-in Codes for Tomorrow HR evaluation engine. Gmail fetching and attachment processing remain functional.',
      );
    } else {
      this.logger.info(
        'Google Gemini AI integration initialized successfully with durable retry configuration',
        {
          model: this.config.model,
          timeoutMs: this.config.timeoutMs,
          initialRetryDelayMs: this.config.initialRetryDelayMs,
          maxRetryDelayMs: this.config.maxRetryDelayMs,
          maxAttempts: this.config.maxAttempts,
          maxRetryAgeMs: this.config.maxRetryAgeMs,
          retryWorkerIntervalMs: this.config.retryWorkerIntervalMs,
          maxConcurrentRequests: this.config.maxConcurrentRequests,
        },
      );
    }
  }

  /**
   * Checks whether the Gemini API key is configured.
   */
  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.apiKey.trim().length > 0);
  }

  /**
   * Returns currently configured Gemini model.
   */
  getModel(): string {
    return this.config.model;
  }

  /**
   * Constructs the provider-isolated Redis cache key for a specific message and attachment.
   */
  getCacheKey(messageId: string, attachmentId?: string): string {
    return `gmail:analysis:gemini:${messageId}:${attachmentId || 'email'}`;
  }

  /**
   * Lazily initializes and returns the GoogleGenAI SDK client.
   */
  private getClient(): GoogleGenAI {
    if (!this.isConfigured()) {
      throw new Error(
        'Google Gemini API key is not configured (GEMINI_API_KEY is missing)',
      );
    }

    if (!this.geminiClient) {
      this.geminiClient = new GoogleGenAI({
        apiKey: this.config.apiKey,
      });
    }

    return this.geminiClient;
  }

  /**
   * Detects empty, unreadable, or suspiciously short extracted text.
   * A valid resume contains contact info, education, and experience (typically > 80 chars, > 15 words).
   * Also identifies standalone page numbers or print footers like "-- 1 of 1 --".
   */
  public isSuspiciouslyShortText(text?: string | null): boolean {
    if (!text) return true;
    const trimmed = text.trim();
    if (trimmed.length < 80) return true;

    // Detect print footers or headers alone (e.g. "-- 1 of 1 --", "Page 1 of 1")
    const isFooterOnly =
      /^(--\s*\d+\s*of\s*\d+\s*--|page\s*\d+(\s*of\s*\d+)?|\d+\s*\/\s*\d+)$/i.test(
        trimmed,
      );
    if (isFooterOnly) return true;

    const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
    if (words.length < 15) return true;

    return false;
  }

  /**
   * Performs OCR text extraction on scanned or image-based PDF/image documents
   * using Google Gemini multimodal vision.
   */
  public async extractTextWithOcr(
    buffer: Buffer,
    mimeType: string = 'application/pdf',
  ): Promise<{ text?: string; error?: string }> {
    if (!this.isConfigured()) {
      return {
        error: 'Gemini OCR unavailable: GEMINI_API_KEY is not configured',
      };
    }

    try {
      const client = this.getClient();
      const response = await client.models.generateContent({
        model: this.config.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: buffer.toString('base64'),
                  mimeType,
                },
              },
              {
                text: 'Extract all text from this resume document accurately, maintaining structure and logical sections. Transcribe candidate contact details, experience, education, and skills faithfully. Output only the extracted resume text without commentary.',
              },
            ],
          },
        ],
      });

      const extractedText = response.text?.trim();
      if (!extractedText || this.isSuspiciouslyShortText(extractedText)) {
        return {
          error:
            'RESUME_EXTRACTION_INSUFFICIENT: Document contains no readable text or insufficient text to evaluate',
        };
      }

      return { text: extractedText };
    } catch (err: any) {
      this.logger.warn(`OCR text extraction failed: ${err.message}`, {
        cause: err.message,
      });
      return { error: `OCR extraction failed: ${err.message}` };
    }
  }

  /**
   * System prompt instructing Gemini on evaluation against Codes for Tomorrow
   * target role requirements, description, and rubric.
   */
  private buildSystemPrompt(targetRole?: JobRoleDefinition | null): string {
    const roleTitle = targetRole?.title || 'Codes for Tomorrow Position';
    const roleDescription =
      targetRole?.description ||
      'Evaluating candidate against configured vacancy requirements.';
    const requiredSkills =
      targetRole?.requiredSkills?.join(', ') || 'Demonstrated core job skills';
    const rubricSections = targetRole?.scoringRubric || [];

    const rubricText =
      rubricSections.length > 0
        ? rubricSections
            .map(
              (s) =>
                `- ${s.name} (${s.description}): up to ${s.maxScore} points (indicators: ${s.keywords.join(', ')})`,
            )
            .join('\n')
        : `- Core competency and job role match: up to 100 points`;

    return `You are an expert AI recruitment screening assistant evaluating applications for Codes for Tomorrow:
TARGET POSITION:
"${roleTitle}"

ROLE DESCRIPTION:
${roleDescription}

REQUIRED SKILLS:
${requiredSkills}

SOURCE OF REQUIREMENTS:
Use ONLY the target position description and rubric below as the exclusive source of job requirements. Do NOT score against unrelated roles or default to HR Intern keywords.

CORE ELIGIBILITY & FAIRNESS RULES:
1. Freshers and candidates with 0–2 years of experience are eligible.
2. DO NOT automatically reject candidates for having no professional experience.
3. DO NOT require candidates to match every listed skill.
4. Missing information is NOT proof of lack of ability. Do not penalize candidates simply for being freshers, having fewer years of experience, or lacking a particular tool that the JD describes as advantageous rather than mandatory.
5. Score ONLY evidence supported by the resume against the target role: "${roleTitle}".

EVALUATION RUBRIC (Total 100 points):
${rubricText}

INITIAL ROUTING THRESHOLDS & BUSINESS RULES:
- 60–100: Shortlist for consideration (recommendedStatus: "Shortlist", screeningStatus: "SHORTLIST", hrReviewRequired: false)
- 40–59: HR Review (recommendedStatus: "HR Review", screeningStatus: "MANUAL_REVIEW", hrReviewRequired: true)
- Below 40: HR Review before rejection (recommendedStatus: "Not Shortlisted", screeningStatus: "MANUAL_REVIEW", hrReviewRequired: true)
CRITICAL: A low score alone must NEVER automatically reject a candidate. Set screeningStatus to "MANUAL_REVIEW" and hrReviewRequired to true for any score below 60.

OUTPUT FORMAT:
Output ONLY a valid, RFC 8259 compliant JSON object adhering strictly to the schema below. Do NOT wrap in markdown code fences, and do NOT include preamble or commentary.`;
  }

  /**
   * Formats the user prompt enclosing candidate application and target role context.
   */
  private buildUserPrompt(
    input: AnalyzeApplicationInput,
    targetRole?: JobRoleDefinition | null,
  ): string {
    const {
      subject,
      sender,
      recipient,
      receivedDate,
      emailBody,
      resumeText,
      filename,
      jobRole,
      jobDescription,
      mandatoryCriteria,
    } = input;

    const resolvedRoleTitle =
      targetRole?.title || jobRole || 'Codes for Tomorrow Vacancy';
    const resolvedDescription =
      targetRole?.description ||
      jobDescription ||
      'Evaluating candidate against vacancy requirements.';
    const hasResume = Boolean(resumeText && resumeText.trim().length > 0);

    return `Please screen and analyze the following application for Codes for Tomorrow:

<target_job_context>
Target Position: ${resolvedRoleTitle}
Job Description: ${resolvedDescription}
Mandatory Eligibility Criteria: ${
      mandatoryCriteria && mandatoryCriteria.length > 0
        ? mandatoryCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
        : 'Freshers and 0–2 years experience eligible. Match score alone must not auto-reject.'
    }
</target_job_context>

<application_metadata>
Subject: ${subject || 'N/A'}
Sender: ${sender?.name ? `${sender.name} <${sender.email}>` : sender?.email || 'N/A'}
Recipient: ${recipient || 'N/A'}
Received Date: ${receivedDate ? new Date(receivedDate).toISOString() : 'N/A'}
Attached Resume Filename: ${filename || (hasResume ? 'resume' : 'None')}
</application_metadata>

<email_content>
${emailBody || '[No email body text provided]'}
</email_content>

<resume_content>
${hasResume ? resumeText : '[No readable resume document was provided with this application]'}
</resume_content>

Extract all candidate details into the required JSON schema adhering to the role-specific scoring rubric. If the resume is missing or unreadable, set matchScore to null, screeningStatus to "MANUAL_REVIEW", hrReviewRequired to true, and note the missing information in screeningExplanation.`;
  }

  /**
   * Builds the JSON schema definition for Gemini structured output.
   */
  private getResponseJsonSchema(): any {
    return {
      type: Type.OBJECT,
      properties: {
        candidate: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, nullable: true },
            email: { type: Type.STRING, nullable: true },
            phone: { type: Type.STRING, nullable: true },
          },
          required: ['name', 'email', 'phone'],
        },
        application: {
          type: Type.OBJECT,
          properties: {
            jobRole: { type: Type.STRING, nullable: true },
            skills: { type: Type.ARRAY, items: { type: Type.STRING } },
            projects: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, nullable: true },
                  description: { type: Type.STRING, nullable: true },
                  technologies: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
              },
            },
            education: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  institution: { type: Type.STRING, nullable: true },
                  degree: { type: Type.STRING, nullable: true },
                  fieldOfStudy: { type: Type.STRING, nullable: true },
                  year: { type: Type.STRING, nullable: true },
                },
              },
            },
            experience: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  company: { type: Type.STRING, nullable: true },
                  role: { type: Type.STRING, nullable: true },
                  duration: { type: Type.STRING, nullable: true },
                  description: { type: Type.STRING, nullable: true },
                },
              },
            },
          },
          required: [
            'jobRole',
            'skills',
            'projects',
            'education',
            'experience',
          ],
        },
        summary: { type: Type.STRING },
        matchScore: { type: Type.NUMBER, nullable: true },
        matchedRequirements: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        missingOrUnclearRequirements: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        screeningStatus: {
          type: Type.STRING,
          enum: ['SHORTLIST', 'REJECT', 'MANUAL_REVIEW'],
        },
        screeningExplanation: { type: Type.STRING },
        hrReviewRequired: { type: Type.BOOLEAN },

        // Role tracking
        appliedRole: { type: Type.STRING },
        resolvedRole: { type: Type.STRING },
        suggestedAlternativeRole: { type: Type.STRING },

        // Structured screening fields
        experienceCategory: {
          type: Type.STRING,
          enum: [
            'Fresher / no professional experience',
            'Relevant HR or recruitment internship',
            'Relevant recruitment work experience',
            'Other or unrelated experience',
            'Unclear / insufficient information',
          ],
        },
        relevantExperienceResponsibilities: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        scoreEvidence: {
          type: Type.OBJECT,
          properties: {
            recruitmentAndTalentAcquisition: { type: Type.NUMBER },
            practicalInternshipOrWork: { type: Type.NUMBER },
            screeningSchedulingAndFollowups: { type: Type.NUMBER },
            sourcingChannels: { type: Type.NUMBER },
            communicationAndCoordination: { type: Type.NUMBER },
            excelOrGoogleSheets: { type: Type.NUMBER },
            otherHrOperations: { type: Type.NUMBER },
            evidenceNotes: { type: Type.STRING },
          },
        },
        missingOrUnclearInformation: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        strengthsAgainstJd: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        gapsAgainstJd: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        suggestedProfile: {
          type: Type.STRING,
        },
        recommendedStatus: {
          type: Type.STRING,
          enum: [
            'Shortlist',
            'HR Review',
            'Not Shortlisted',
            'Requires Human Review',
          ],
        },
      },
      required: [
        'candidate',
        'application',
        'summary',
        'matchScore',
        'matchedRequirements',
        'missingOrUnclearRequirements',
        'screeningStatus',
        'screeningExplanation',
        'hrReviewRequired',
        'experienceCategory',
        'relevantExperienceResponsibilities',
        'missingOrUnclearInformation',
        'strengthsAgainstJd',
        'gapsAgainstJd',
        'suggestedProfile',
        'recommendedStatus',
      ],
    };
  }

  /**
   * Calls Google Gemini API with bounded retries and exponential backoff for transient failures.
   */
  private async callGeminiApi(
    systemPrompt: string,
    userPrompt: string,
    options?: { maxRetries?: number },
  ): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
    const client = this.getClient();
    const maxRetries = options?.maxRetries ?? this.config.maxRetries;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const timeoutMs = this.config.timeoutMs || 60000;
        const generatePromise = client.models.generateContent({
          model: this.config.model,
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            responseJsonSchema: this.getResponseJsonSchema(),
            temperature: this.config.temperature,
            maxOutputTokens: this.config.maxOutputTokens,
          },
        });

        // Timeout wrapper
        const response: any = await Promise.race([
          generatePromise,
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Google Gemini API call timed out after ${timeoutMs}ms`,
                  ),
                ),
              timeoutMs,
            ),
          ),
        ]);

        const candidate = response?.candidates?.[0];
        if (candidate?.finishReason === 'SAFETY') {
          this.logger.error(
            'Google Gemini response was blocked by safety filters',
            {
              finishReason: candidate.finishReason,
              safetyRatings: candidate.safetyRatings,
            },
          );
          throw new GeminiPermanentException(
            'Google Gemini response blocked by safety filters',
            { code: 'SAFETY_BLOCKED' },
          );
        }

        const textBlock =
          response?.text || candidate?.content?.parts?.[0]?.text;

        if (!textBlock || String(textBlock).trim().length === 0) {
          throw new GeminiTransientException(
            'Empty text content received from Google Gemini API',
            { status: 500, code: 'EMPTY_RESPONSE' },
          );
        }

        const usage = response?.usageMetadata;
        return {
          text: String(textBlock),
          inputTokens: usage?.promptTokenCount,
          outputTokens: usage?.candidatesTokenCount,
        };
      } catch (err: any) {
        attempt++;
        const classified = classifyGeminiError(err);

        if (classified.isPermanent) {
          this.logger.error(
            'Google Gemini API encountered non-retryable permanent error',
            {
              model: this.config.model,
              status: classified.status,
              code: classified.code,
              reason: classified.reason,
            },
          );
          throw new GeminiPermanentException(classified.reason, {
            status: classified.status,
            code: classified.code,
            cause: err,
          });
        }

        // Classified as transient error (503, 429, 500, timeouts, etc.)
        if (attempt <= maxRetries) {
          const delayMs = calculateBackoffWithJitter(
            attempt,
            this.config.initialRetryDelayMs || 2000,
            this.config.maxRetryDelayMs || 60000,
            classified.retryAfterMs,
          );

          this.logger.warn(
            'Google Gemini API call encountered transient failure; retrying with backoff and jitter',
            {
              attempt,
              maxRetries,
              model: this.config.model,
              status: classified.status,
              code: classified.code,
              delayMs,
              retryAfterMs: classified.retryAfterMs,
            },
          );

          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        this.logger.error(
          'Google Gemini API call failed with transient error after in-call retries',
          {
            model: this.config.model,
            status: classified.status,
            code: classified.code,
            attempts: attempt,
            reason: classified.reason,
          },
        );

        throw new GeminiTransientException(classified.reason, {
          status: classified.status,
          code: classified.code,
          retryAfterMs: classified.retryAfterMs,
          cause: err,
        });
      }
    }

    throw new GeminiTransientException(
      'Google Gemini API call exceeded maximum retries',
      { status: 503, code: 'UNAVAILABLE' },
    );
  }

  /**
   * Cleans potential markdown code fences from model response.
   */
  private cleanJsonResponse(rawText: string): string {
    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
    }
    return cleaned;
  }

  /**
   * Deterministic evidence extraction and scoring engine for all supported job roles.
   * Delegates to RoleScoringEngine.
   */
  public evaluateResumeEvidence(
    resumeText: string,
    targetRole?: JobRoleDefinition | null,
    metadata?: {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      subject?: string | null;
    },
  ): CandidateApplicationAnalysis {
    return RoleScoringEngine.evaluateEvidence(
      resumeText,
      targetRole || null,
      metadata,
    );
  }

  /**
   * Deterministic evidence extraction and scoring engine for Codes for Tomorrow
   * HR Intern and HR Associate / HR Executive job profiles (delegates to RoleScoringEngine).
   */
  public evaluateHrResumeEvidence(
    resumeText: string,
    metadata?: {
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      subject?: string | null;
    },
  ): CandidateApplicationAnalysis {
    return RoleScoringEngine.evaluateHrResumeEvidence(resumeText, metadata);
  }

  /**
   * Analyzes an application using Google Gemini or the built-in Codes for Tomorrow HR engine.
   * Prevents duplicate API calls by checking Redis cache first and acquiring a concurrency lock.
   */
  async analyzeApplication(
    input: AnalyzeApplicationInput,
  ): Promise<ResumeAnalysisResult> {
    const { messageId, attachmentId, filename } = input;
    const cacheKey = this.getCacheKey(messageId, attachmentId);
    const lockKey = `gmail:analysis:lock:${messageId}:${attachmentId || 'email'}`;
    const now = new Date().toISOString();

    // 0. Resolve target role from explicit input, email subject, and body using RoleDetectionService
    const roleResolution = this.getRoleDetector().resolveRole({
      subject: input.subject,
      emailBody: input.emailBody,
      metadataRole: input.jobRole,
      trustedRole: input.jobRole,
    });
    const targetRole = roleResolution.role;

    // 1. Check Redis cache first to guarantee idempotency and avoid duplicate API usage
    try {
      const cached = await this.redisService.client.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as ResumeAnalysisResult;
        const isCachedInsufficient =
          parsed.analysis?.rejectionReason ===
            'RESUME_EXTRACTION_INSUFFICIENT' ||
          parsed.model === 'insufficient-extraction-guard' ||
          (parsed.analysis?.matchScore === 0 &&
            (parsed.analysis as any)?.experienceCategory ===
              'Unclear / insufficient information');

        if (
          isCachedInsufficient &&
          input.resumeText &&
          !this.isSuspiciouslyShortText(input.resumeText)
        ) {
          this.logger.info(
            'Cached Gemini screening result was for insufficient text, but sufficient resume text is now available; invalidating old cache',
            { messageId, attachmentId, cacheKey },
          );
          await this.redisService.client.del(cacheKey);
        } else {
          this.logger.info(
            'Returning cached Gemini screening result from Redis',
            {
              messageId,
              attachmentId,
              cacheKey,
            },
          );
          return parsed;
        }
      }
    } catch (err: any) {
      this.logger.warn('Failed to read from Redis cache for Gemini analysis', {
        messageId,
        attachmentId,
        cause: err.message,
      });
    }

    // 2. Guard against unconfigured API key: fallback to built-in evaluation engine
    if (!this.isConfigured()) {
      this.logger.info(
        'GEMINI_API_KEY is not configured; using built-in evaluation engine',
        {
          messageId,
          attachmentId,
          targetRole: targetRole?.canonicalRole || 'NONE',
          resolutionStatus: roleResolution.status,
        },
      );

      let analysis: CandidateApplicationAnalysis;
      if (
        !targetRole ||
        roleResolution.status === 'CONFLICT' ||
        roleResolution.status === 'UNRESOLVED'
      ) {
        analysis = RoleScoringEngine.createManualReviewAnalysis({
          roleTitle: roleResolution.appliedRole || 'Undetected Vacancy',
          reason: roleResolution.reason || 'ROLE_UNDETECTED',
          explanation:
            roleResolution.explanation ||
            'Job role could not be reliably resolved from application metadata or email context. Routed to manual HR review.',
          metadata: {
            name: input.sender?.name,
            email: input.sender?.email,
            subject: input.subject,
          },
          appliedRole: roleResolution.appliedRole,
        });
      } else {
        analysis = this.evaluateResumeEvidence(
          input.resumeText || input.emailBody || '',
          targetRole,
          {
            name: input.sender?.name,
            email: input.sender?.email,
            subject: input.subject,
          },
        );
      }

      const fallbackResult: ResumeAnalysisResult = {
        attachmentId,
        filename,
        status: 'success',
        analysis,
        analyzedAt: now,
        model: 'built-in-cft-engine',
      };

      try {
        await this.redisService.client.set(
          cacheKey,
          JSON.stringify(fallbackResult),
          'EX',
          GeminiService.ANALYSIS_CACHE_TTL_SECONDS,
        );
      } catch {}

      return fallbackResult;
    }

    // 3. Acquire concurrency lock in Redis (TTL = 2 minutes) to prevent duplicate simultaneous calls
    let lockAcquired = false;
    try {
      const lockRes = await this.redisService.client.set(
        lockKey,
        'processing',
        'EX',
        120,
        'NX',
      );
      lockAcquired = lockRes === 'OK';
    } catch (err: any) {
      this.logger.warn(
        'Redis lock acquisition error; proceeding without lock',
        {
          lockKey,
          cause: err.message,
        },
      );
    }

    if (!lockAcquired) {
      this.logger.warn(
        'Concurrent Gemini analysis already in progress for this item; skipping duplicate call',
        { messageId, attachmentId, lockKey },
      );
      return {
        attachmentId,
        filename,
        status: 'skipped',
        error:
          'Analysis already in progress concurrently for this application item',
        analyzedAt: now,
        model: this.config.model,
      };
    }

    const startTime = Date.now();

    // Guard: Detect empty, unreadable, or suspiciously short extracted text before sending to Gemini API
    const effectiveResumeText = input.resumeText?.trim() || '';
    if (this.isSuspiciouslyShortText(effectiveResumeText)) {
      this.logger.warn(
        `Resume text for ${input.filename || attachmentId} is empty or suspiciously short (${effectiveResumeText.length} chars). Skipping automated ATS scoring; routing to Manual Review with RESUME_EXTRACTION_INSUFFICIENT`,
        { messageId, attachmentId, length: effectiveResumeText.length },
      );

      const insufficientAnalysis = targetRole
        ? this.evaluateResumeEvidence(effectiveResumeText, targetRole, {
            name: input.sender?.name,
            email: input.sender?.email,
            subject: input.subject,
          })
        : RoleScoringEngine.createManualReviewAnalysis({
            roleTitle: roleResolution.appliedRole || 'Undetected Vacancy',
            reason: 'RESUME_EXTRACTION_INSUFFICIENT',
            explanation:
              'RESUME_EXTRACTION_INSUFFICIENT: Resume document contains no readable text or insufficient text for automated scoring. Routed to HR Review for manual evaluation.',
            metadata: {
              name: input.sender?.name,
              email: input.sender?.email,
              subject: input.subject,
            },
            appliedRole: roleResolution.appliedRole,
          });

      const result: ResumeAnalysisResult = {
        attachmentId,
        filename,
        status: 'success',
        analysis: insufficientAnalysis,
        analyzedAt: now,
        model: 'insufficient-extraction-guard',
      };

      if (lockAcquired) {
        try {
          await this.redisService.client.del(lockKey);
        } catch {}
      }

      return result;
    }

    try {
      // 4. Construct prompts
      const systemPrompt = this.buildSystemPrompt(targetRole);
      const userPrompt = this.buildUserPrompt(input, targetRole);

      // 5. Execute Gemini API call with bounded exponential retries
      const {
        text: rawText,
        inputTokens,
        outputTokens,
      } = await this.callGeminiApi(systemPrompt, userPrompt);

      // 6. Clean markdown fences and parse JSON
      const cleanedJson = this.cleanJsonResponse(rawText);
      let parsedData: any;
      try {
        parsedData = JSON.parse(cleanedJson);
      } catch (jsonErr: any) {
        this.logger.error('Failed to parse Google Gemini JSON response', {
          messageId,
          attachmentId,
          rawResponse: rawText.slice(0, 500),
          cause: jsonErr.message,
        });
        return {
          attachmentId,
          filename,
          status: 'failed',
          error: `Malformed JSON returned by Google Gemini: ${jsonErr.message}`,
          analyzedAt: now,
          model: this.config.model,
        };
      }

      // 7. Validate against strict runtime schema and Codes for Tomorrow thresholds
      const validation = validateApplicationAnalysis(parsedData);
      if (!validation.valid || !validation.analysis) {
        this.logger.error('Google Gemini output failed schema validation', {
          messageId,
          attachmentId,
          validationErrors: validation.errors,
        });
        return {
          attachmentId,
          filename,
          status: 'failed',
          error: `Google Gemini response schema validation failed: ${validation.errors.join('; ')}`,
          analyzedAt: now,
          model: this.config.model,
        };
      }

      if (validation.analysis) {
        if (!validation.analysis.appliedRole) {
          validation.analysis.appliedRole =
            roleResolution.appliedRole ||
            targetRole?.title ||
            input.jobRole ||
            input.subject;
        }
        if (!validation.analysis.resolvedRole && targetRole) {
          validation.analysis.resolvedRole = targetRole.title;
        }
      }

      const durationMs = Date.now() - startTime;
      const result: ResumeAnalysisResult = {
        attachmentId,
        filename,
        status: 'success',
        analysis: validation.analysis,
        analyzedAt: now,
        model: this.config.model,
      };

      // 8. Cache successful result in Redis and add to message analyses set
      try {
        await this.redisService.client.set(
          cacheKey,
          JSON.stringify(result),
          'EX',
          GeminiService.ANALYSIS_CACHE_TTL_SECONDS,
        );
        const setKey = `gmail:analyses:${messageId}`;
        await this.redisService.client.sadd(setKey, cacheKey);
      } catch (cacheErr: any) {
        this.logger.warn('Failed to cache Gemini analysis result in Redis', {
          messageId,
          attachmentId,
          cause: cacheErr.message,
        });
      }

      this.logger.info(
        'Codes for Tomorrow HR analysis completed successfully',
        {
          messageId,
          attachmentId,
          screeningStatus: result.analysis?.screeningStatus,
          matchScore: result.analysis?.matchScore,
          experienceCategory: result.analysis?.experienceCategory,
          suggestedProfile: result.analysis?.suggestedProfile,
          recommendedStatus: result.analysis?.recommendedStatus,
          durationMs,
          model: this.config.model,
          inputTokens,
          outputTokens,
        },
      );

      return result;
    } catch (err: any) {
      const classified = classifyGeminiError(err);
      this.logger.error('Google Gemini analysis execution failed', {
        messageId,
        attachmentId,
        isTransient: classified.isTransient,
        isPermanent: classified.isPermanent,
        httpStatus: classified.status,
        code: classified.code,
        model: this.config.model,
        cause: classified.reason,
      });

      // Failed analysis is NOT cached, preserving retry eligibility on subsequent polling runs
      return {
        attachmentId,
        filename,
        status: 'failed',
        isTransient: classified.isTransient,
        isPermanent: classified.isPermanent,
        httpStatus: classified.status,
        retryAfterMs: classified.retryAfterMs,
        error: classified.reason,
        analyzedAt: now,
        model: this.config.model,
      };
    } finally {
      // 9. Release Redis lock
      try {
        await this.redisService.client.del(lockKey);
      } catch (err: any) {
        this.logger.warn('Failed to release Redis lock', {
          lockKey,
          cause: err.message,
        });
      }
    }
  }

  /**
   * Retrieves all stored Gemini analyses for a given messageId from Redis.
   */
  async getStoredMessageAnalyses(
    messageId: string,
  ): Promise<ResumeAnalysisResult[]> {
    try {
      const setKey = `gmail:analyses:${messageId}`;
      const cacheKeys = await this.redisService.client.smembers(setKey);

      if (cacheKeys && cacheKeys.length > 0) {
        const results: ResumeAnalysisResult[] = [];
        for (const key of cacheKeys) {
          const item = await this.redisService.client.get(key);
          if (item) {
            results.push(JSON.parse(item));
          }
        }
        return results;
      }

      // Fallback check for single message analysis key
      const singleKey = this.getCacheKey(messageId);
      const singleItem = await this.redisService.client.get(singleKey);
      if (singleItem) {
        return [JSON.parse(singleItem)];
      }

      return [];
    } catch (err: any) {
      this.logger.error('Failed to retrieve stored message analyses', {
        messageId,
        cause: err.message,
      });
      return [];
    }
  }
}
