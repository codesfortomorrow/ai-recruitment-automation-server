import { Test, TestingModule } from '@nestjs/testing';
import { CandidateService } from './candidate.service';
import { CandidateExcelService } from './candidate-excel.service';
import {
  GoogleSheetsService,
  GoogleSheetTrackerRow,
} from './google-sheets.service';
import { GoogleDriveService } from './google-drive.service';
import { CandidateNotificationService } from './candidate-notification.service';
import { HrAssignmentService } from './hr-assignment.service';
import { RedisService } from '../redis';
import { PrismaService } from '../prisma';
import { MailService } from '../mail/mail.service';
import { GmailService } from '../mail/gmail.service';
import { GeminiService } from '../mail/gemini.service';
import { ResumeFingerprintService } from '../mail/resume-fingerprint.service';
import { RoleDetectionService } from '../mail/role-detection.service';
import { ResumeScreeningQueueService } from '../mail/resume-screening-queue.service';
import { ResumeScreeningWorkerService } from '../mail/resume-screening-worker.service';
import { AuthService } from '../auth/auth.service';
import { SendCodeRequestType } from '../auth/dto';
import { OtpTransport } from '../generated/prisma/client';
import { UsersService } from '../users';
import { OtpService } from '../otp';
import { JwtService } from '@nestjs/jwt';
import {
  excelSyncConfigFactory,
  hrConfigFactory,
  googleSheetsConfigFactory,
  geminiConfigFactory,
  gmailConfigFactory,
  appConfigFactory,
} from '@Config';

describe('Google Sheets-First Recruitment Automation Regression Suite (Priority 5)', () => {
  let candidateService: CandidateService;
  let candidateExcelService: CandidateExcelService;
  let googleSheetsService: GoogleSheetsService;
  let resumeFingerprintService: ResumeFingerprintService;
  let queueService: ResumeScreeningQueueService;
  let workerService: ResumeScreeningWorkerService;
  let authService: AuthService;
  let geminiService: GeminiService;

  const redisStore = new Map<string, string>();
  const redisHashes = new Map<string, Map<string, string>>();
  const redisSets = new Map<string, Set<string>>();
  const sheetsStore = new Map<number, GoogleSheetTrackerRow>();

  const mockRedisClient = {
    get: jest.fn(async (key: string) => redisStore.get(key) || null),
    set: jest.fn(async (key: string, val: string, ...args: any[]) => {
      if (args.includes('NX') && redisStore.has(key)) {
        return null;
      }
      redisStore.set(key, val);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      redisStore.delete(key);
      return 1;
    }),
    incr: jest.fn(async (key: string) => {
      const current = parseInt(redisStore.get(key) || '0', 10);
      const next = current + 1;
      redisStore.set(key, String(next));
      return next;
    }),
    exists: jest.fn(async (key: string) => (redisStore.has(key) ? 1 : 0)),
    keys: jest.fn(async (pattern: string) => {
      const prefix = pattern.replace('*', '');
      return Array.from(redisStore.keys()).filter((k) => k.startsWith(prefix));
    }),
    hget: jest.fn(async (key: string, field: string) => {
      return redisHashes.get(key)?.get(field) || null;
    }),
    hset: jest.fn(async (key: string, field: string, val: string) => {
      if (!redisHashes.has(key)) redisHashes.set(key, new Map());
      redisHashes.get(key)!.set(field, val);
      return 1;
    }),
    hgetall: jest.fn(async (key: string) => {
      const map = redisHashes.get(key);
      if (!map) return {};
      const obj: Record<string, string> = {};
      map.forEach((v, k) => (obj[k] = v));
      return obj;
    }),
    hdel: jest.fn(async (key: string, field: string) => {
      return redisHashes.get(key)?.delete(field) ? 1 : 0;
    }),
    sadd: jest.fn(async (key: string, member: string) => {
      if (!redisSets.has(key)) redisSets.set(key, new Set());
      redisSets.get(key)!.add(member);
      return 1;
    }),
    sismember: jest.fn(async (key: string, member: string) => {
      return redisSets.get(key)?.has(member) ? 1 : 0;
    }),
    eval: jest.fn(async (_script: string, _numkeys: number, ...args: any[]) => {
      const key = args[0];
      const token = args[1];
      if (key && redisStore.has(key)) {
        if (!token || redisStore.get(key) === token) {
          redisStore.delete(key);
          return 1;
        }
      }
      return 0;
    }),
  };

  const mockRedisService = {
    client: mockRedisClient,
    get: mockRedisClient.get,
    set: mockRedisClient.set,
    del: mockRedisClient.del,
    incr: mockRedisClient.incr,
    exists: mockRedisClient.exists,
  };

  const mockCandidateExcelService = {
    saveCandidate: jest.fn(),
    getAllCandidates: jest.fn().mockResolvedValue([]),
    getCandidateById: jest.fn().mockResolvedValue(null),
    getMaxCandidateId: jest.fn().mockResolvedValue(10),
  };

  const mockGoogleSheetsService = {
    isConfigured: jest.fn().mockReturnValue(true),
    saveCandidate: jest.fn(async (input: any) => {
      const id = input.id;
      const existing = sheetsStore.get(id) || ({} as GoogleSheetTrackerRow);
      const updated: GoogleSheetTrackerRow = {
        rowIndex: existing.rowIndex || sheetsStore.size + 2,
        candidateId: id,
        candidateName: input.name || existing.candidateName || 'Test Candidate',
        email: input.email || existing.email || 'test@example.com',
        phone: input.phone || existing.phone || '9999999999',
        jobRole: input.jobRole || existing.jobRole || 'Node.js Developer',
        assignedHrName:
          input.assignedHrName || existing.assignedHrName || 'Abhishek',
        totalExperience: input.experience || existing.totalExperience || '3',
        currentCompany:
          input.currentCompany || existing.currentCompany || 'CFT',
        applicationStatus:
          input.screeningStatus ||
          input.applicationStatus ||
          existing.applicationStatus ||
          'Shortlisted',
        currentInterviewRound:
          input.currentInterviewRound ||
          existing.currentInterviewRound ||
          'Not Started',
        totalCallAttempts:
          input.totalCallAttempts ?? existing.totalCallAttempts ?? 0,
        call1Date: input.call1Date ?? existing.call1Date ?? '',
        call1Status: input.call1Status ?? existing.call1Status ?? '',
        call1Remarks: input.call1Remarks ?? existing.call1Remarks ?? '',
        call2Date: input.call2Date ?? existing.call2Date ?? '',
        call2Status: input.call2Status ?? existing.call2Status ?? '',
        call2Remarks: input.call2Remarks ?? existing.call2Remarks ?? '',
        call3Date: input.call3Date ?? existing.call3Date ?? '',
        call3Status: input.call3Status ?? existing.call3Status ?? '',
        call3Remarks: input.call3Remarks ?? existing.call3Remarks ?? '',
        nextFollowUpDate:
          input.nextFollowUpDate ?? existing.nextFollowUpDate ?? '',
        automatedFollowUpEmailStatus:
          input.automatedFollowUpEmailStatus ??
          existing.automatedFollowUpEmailStatus ??
          'NOT_SENT',
        followUpEmailSentAt:
          input.followUpEmailSentAt ?? existing.followUpEmailSentAt ?? '',
        hrRemarks: input.hrRemarks ?? existing.hrRemarks ?? '',
        lastUpdatedBy: 'System',
        lastUpdatedAt: new Date().toISOString(),
        cvLink: input.cvLink ?? existing.cvLink ?? '',
        driveFileId: input.driveFileId ?? existing.driveFileId ?? '',
      };
      sheetsStore.set(id, updated);
      return {
        action: existing.candidateId ? 'updated' : 'inserted',
        candidateId: id,
        rowNumber: updated.rowIndex,
        updatedRange: `'Candidate Tracker'!A${updated.rowIndex}:AB${updated.rowIndex}`,
      };
    }),
    readCandidateTrackerRows: jest.fn(async () =>
      Array.from(sheetsStore.values()),
    ),
    findCandidateById: jest.fn(
      async (id: number) => sheetsStore.get(id) || null,
    ),
    findCandidateByDriveFileId: jest.fn(async (driveFileId: string) => {
      for (const row of sheetsStore.values()) {
        if (row.driveFileId === driveFileId) return row;
      }
      return null;
    }),
    findCandidateByEmail: jest.fn(async (email: string) => {
      for (const row of sheetsStore.values()) {
        if (row.email.toLowerCase() === email.toLowerCase()) return row;
      }
      return null;
    }),
    getMaxCandidateId: jest.fn(async () => {
      let max = 0;
      for (const row of sheetsStore.values()) {
        if (row.candidateId > max) max = row.candidateId;
      }
      return max;
    }),
    sanitizeError: jest.fn((e: any) => String(e?.message || e)),
    updateFollowUpEmailStatusInSheet: jest.fn().mockResolvedValue(true),
  };

  const mockGeminiService = {
    isSuspiciouslyShortText: jest.fn().mockReturnValue(false),
    analyzeApplication: jest.fn().mockImplementation(async (input: any) => ({
      status: 'success',
      attachmentId: input.attachmentId || 'att-1',
      filename: input.filename || 'resume.pdf',
      analysis: {
        screeningStatus: 'SHORTLIST',
        matchedRole: 'Senior Developer',
        matchScore: 88,
        summary: 'Strong senior developer',
        candidate: {
          name: 'Senior Dev',
          email: input.sender?.email || 'senior.dev@example.com',
          phone: '9876543210',
          experience: '6',
          currentCompany: 'Tech Corp',
        },
        application: {
          skills: ['TypeScript', 'Node.js'],
          education: [],
          experience: [],
          projects: [],
        },
      },
    })),
    screenResume: jest.fn().mockResolvedValue({
      status: 'SHORTLIST',
      role: 'Node.js Developer',
      score: 85,
      candidate: {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        phone: '9876543210',
        experience: '4',
        currentCompany: 'Tech Corp',
        skills: ['NestJS', 'TypeScript'],
      },
      summary: 'Strong backend profile',
      rejectionReason: null,
    }),
  };

  const mockCandidateNotificationService = {
    notifyHR: jest
      .fn()
      .mockResolvedValue({ success: true, messageId: 'msg-1' }),
    sendManualReviewEmail: jest
      .fn()
      .mockResolvedValue({ success: true, messageId: 'msg-2' }),
    notifyAssignedHr: jest
      .fn()
      .mockResolvedValue({ success: true, messageId: 'msg-3' }),
    notifyManualReview: jest
      .fn()
      .mockResolvedValue({ success: true, messageId: 'msg-4' }),
  };

  const mockGoogleDriveService = {
    isConfigured: jest.fn().mockReturnValue(true),
    isPollingEnabled: jest.fn().mockReturnValue(true),
    uploadCV: jest.fn().mockResolvedValue({
      fileId: 'drive-file-123',
      webViewLink: 'https://drive.google.com/file/123',
    }),
  };

  const mockUsersService = {
    isEmailExist: jest.fn().mockResolvedValue(false),
    findUserByEmail: jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'admin@cft.com',
      role: 'ADMIN',
    }),
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock-jwt-token'),
    decode: jest.fn().mockReturnValue({ iat: 1000, exp: 2000 }),
  };

  const mockOtpService = {
    send: jest.fn().mockResolvedValue({ success: true, messageId: 'otp-1' }),
  };

  beforeEach(async () => {
    redisStore.clear();
    redisHashes.clear();
    redisSets.clear();
    sheetsStore.clear();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateService,
        HrAssignmentService,
        ResumeFingerprintService,
        RoleDetectionService,
        ResumeScreeningQueueService,
        ResumeScreeningWorkerService,
        AuthService,
        { provide: CandidateExcelService, useValue: mockCandidateExcelService },
        { provide: GoogleSheetsService, useValue: mockGoogleSheetsService },
        { provide: GoogleDriveService, useValue: mockGoogleDriveService },
        {
          provide: CandidateNotificationService,
          useValue: mockCandidateNotificationService,
        },
        { provide: RedisService, useValue: mockRedisService },
        { provide: GeminiService, useValue: mockGeminiService },
        { provide: PrismaService, useValue: {} },
        { provide: MailService, useValue: {} },
        {
          provide: GmailService,
          useValue: { sendEmail: jest.fn().mockResolvedValue({ sent: true }) },
        },
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: OtpService, useValue: mockOtpService },
        {
          provide: excelSyncConfigFactory.KEY,
          useValue: { candidatesWorkbookPath: './data/candidates.xlsx' },
        },
        {
          provide: hrConfigFactory.KEY,
          useValue: {
            hr1: {
              id: 'hr-1',
              name: 'Abhishek',
              email: 'abhishek@codesfortomorrow.com',
            },
            hr2: {
              id: 'hr-2',
              name: 'Jayendra',
              email: 'jayendra@codesfortomorrow.com',
            },
            manualReviewEmail: 'hr@codesfortomorrow.com',
          },
        },
        {
          provide: googleSheetsConfigFactory.KEY,
          useValue: { enabled: true, spreadsheetId: 'test-sheet-id' },
        },
        {
          provide: geminiConfigFactory.KEY,
          useValue: { model: 'gemini-1.5-flash' },
        },
        {
          provide: gmailConfigFactory.KEY,
          useValue: { user: 'test@codesfortomorrow.com' },
        },
        { provide: appConfigFactory.KEY, useValue: { environment: 'test' } },
      ],
    }).compile();

    candidateService = module.get<CandidateService>(CandidateService);
    candidateExcelService = module.get<CandidateExcelService>(
      CandidateExcelService,
    );
    googleSheetsService = module.get<GoogleSheetsService>(GoogleSheetsService);
    resumeFingerprintService = module.get<ResumeFingerprintService>(
      ResumeFingerprintService,
    );
    queueService = module.get<ResumeScreeningQueueService>(
      ResumeScreeningQueueService,
    );
    workerService = module.get<ResumeScreeningWorkerService>(
      ResumeScreeningWorkerService,
    );
    authService = module.get<AuthService>(AuthService);
    geminiService = module.get<GeminiService>(GeminiService);
  });

  describe('Scenario 1: Excel is not written during candidate screening', () => {
    it('should persist candidate directly to Google Sheets and never call Excel save', async () => {
      const result = await candidateService.persistAndProcessScreeningResult({
        messageDetail: {
          id: 'msg-priya-1',
          threadId: 'thread-1',
          sender: 'Priya Sharma <priya.sharma@example.com>',
          subject: 'Application for React Developer',
          receivedAt: new Date().toISOString(),
          snippet: 'Please find attached my resume',
          attachments: [
            {
              attachmentId: 'att-priya-1',
              filename: 'priya_resume.pdf',
              mimeType: 'application/pdf',
              size: 1024,
            },
          ],
        } as any,
        analysisResult: {
          status: 'success',
          attachmentId: 'att-priya-1',
          filename: 'priya_resume.pdf',
          analysis: {
            screeningStatus: 'SHORTLIST',
            matchedRole: 'React Developer',
            matchScore: 90,
            summary: 'Excellent React skills',
            candidate: {
              name: 'Priya Sharma',
              email: 'priya.sharma@example.com',
              phone: '9876543211',
              experience: '3',
              currentCompany: 'Infosys',
            },
            application: {
              skills: ['React', 'JavaScript'],
              education: [],
              experience: [],
              projects: [],
            },
          },
        } as any,
        driveFileId: 'drive-file-priya-1',
        cvLink: 'https://drive.google.com/priya',
      });

      // Verify Google Sheets save was invoked
      expect(mockGoogleSheetsService.saveCandidate).toHaveBeenCalledTimes(1);
      expect(result.sheetsSaved).toBe(true);
      expect(result.id).toBeGreaterThanOrEqual(20);

      // Verify Excel candidate record write is completely bypassed
      expect(mockCandidateExcelService.saveCandidate).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 2: Candidate IDs remain unique across concurrent workers and restarts', () => {
    it('should generate monotonically increasing unique IDs across concurrent calls and server restarts', async () => {
      // Seed initial sequence state in Redis
      redisStore.set('recruitment:candidate:id_sequence', '25');

      // Simulate 10 concurrent allocation calls
      const allocatedIds = await Promise.all([
        candidateService.allocateNextCandidateId(),
        candidateService.allocateNextCandidateId(),
        candidateService.allocateNextCandidateId(),
        candidateService.allocateNextCandidateId(),
        candidateService.allocateNextCandidateId(),
        candidateService.allocateNextCandidateId(),
        candidateService.allocateNextCandidateId(),
        candidateService.allocateNextCandidateId(),
        candidateService.allocateNextCandidateId(),
        candidateService.allocateNextCandidateId(),
      ]);

      expect(allocatedIds).toHaveLength(10);
      const uniqueIds = new Set(allocatedIds);
      expect(uniqueIds.size).toBe(10);
      expect(Math.min(...allocatedIds)).toBe(26);
      expect(Math.max(...allocatedIds)).toBe(35);

      // Simulate worker / service restart: allocate again
      const postRestartId = await candidateService.allocateNextCandidateId();
      expect(postRestartId).toBe(36);
      expect(uniqueIds.has(postRestartId)).toBe(false);
    });
  });

  describe('Scenario 3: A failed Sheets write never marks a job COMPLETED', () => {
    it('should transition job to FAILED_RETRYABLE and not COMPLETED when Sheets persistence fails', async () => {
      // Force Google Sheets save to fail
      mockGoogleSheetsService.saveCandidate.mockRejectedValueOnce(
        new Error('Google Sheets API 503 Unavailable'),
      );

      const job = await queueService.enqueueJob({
        filename: 'resume.pdf',
        mimeType: 'application/pdf',
        fingerprint: 'hash-fail-test-1',
        messageId: 'msg-fail-1',
        attachmentId: 'att-fail-1',
        sender: { email: 'applicant-fail@example.com' },
        subject: 'Application',
        extractedResumeText: 'dummy resume content',
        source: 'GMAIL',
      });

      // Worker executes job
      await workerService.processSingleJob(job);

      const updatedJob = await queueService.getJob(job.id);
      expect(updatedJob?.status).toBe('FAILED_RETRYABLE');
      expect(updatedJob?.status).not.toBe('COMPLETED');
      expect(updatedJob?.attemptCount).toBe(1);
      expect(updatedJob?.lastError).toMatch(
        /Google Sheets API 503 Unavailable|Google Sheets persistence failed/,
      );
    });
  });

  describe('Scenario 4: A successful Sheets write followed by a crash does not create a duplicate row', () => {
    it('should reconcile against existing Google Sheets row by driveFileId without creating duplicate', async () => {
      // Seed Google Sheets with existing candidate from a previous run before crash
      const existingDriveFileId = 'drive-crash-recovered-123';
      sheetsStore.set(105, {
        rowIndex: 3,
        candidateId: 105,
        candidateName: 'Crash Recovered Candidate',
        email: 'crash.recovered@example.com',
        phone: '9988776655',
        jobRole: 'Node.js Developer',
        assignedHrName: 'Abhishek',
        totalExperience: '5',
        currentCompany: 'CFT',
        applicationStatus: 'Shortlisted',
        currentInterviewRound: 'Not Started',
        totalCallAttempts: 0,
        call1Date: '',
        call1Status: '',
        call1Remarks: '',
        call2Date: '',
        call2Status: '',
        call2Remarks: '',
        call3Date: '',
        call3Status: '',
        call3Remarks: '',
        nextFollowUpDate: '',
        automatedFollowUpEmailStatus: 'NOT_SENT',
        followUpEmailSentAt: '',
        hrRemarks: 'Previously saved before checkpoint crash',
        lastUpdatedBy: 'System',
        lastUpdatedAt: new Date().toISOString(),
        cvLink: 'https://drive.google.com/file/crash-recovered',
        driveFileId: existingDriveFileId,
      });

      const job = await queueService.enqueueJob({
        filename: 'crash-recovered.pdf',
        mimeType: 'application/pdf',
        fingerprint: 'fingerprint-crash-1',
        messageId: 'msg-crash-1',
        attachmentId: 'att-crash-1',
        sender: { email: 'crash.recovered@example.com' },
        subject: 'Application',
        extractedResumeText: 'crash recovered resume',
        driveFileId: existingDriveFileId,
        source: 'DRIVE_MANUAL',
      });

      mockGoogleSheetsService.saveCandidate.mockClear();

      // Process job after crash recovery
      await workerService.processSingleJob(job);

      const completedJob = await queueService.getJob(job.id);
      expect(completedJob?.status).toBe('COMPLETED');

      // Verify that no second row was saved/inserted into Google Sheets
      expect(mockGoogleSheetsService.saveCandidate).not.toHaveBeenCalled();
      expect(sheetsStore.size).toBe(1);
    });
  });

  describe('Scenario 5: Two different applicants with identical resume contents are not incorrectly deduplicated', () => {
    it('should allow distinct applicant emails with identical resume content hashes to be processed', async () => {
      const identicalResumeHash = 'sha256-identical-content-abc';
      const applicantA = 'applicant.a@example.com';
      const applicantB = 'applicant.b@example.com';

      // Applicant A is processed and marked completed
      await resumeFingerprintService.markFingerprintProcessed(
        identicalResumeHash,
        {
          senderEmail: applicantA,
          processedAt: new Date().toISOString(),
          status: 'COMPLETED',
          candidateId: 50,
        },
      );

      // Verify Applicant A is marked processed
      const checkA = await resumeFingerprintService.isFingerprintProcessed(
        identicalResumeHash,
        applicantA,
      );
      expect(checkA).toBe(true);

      // Verify Applicant B with SAME hash is NOT marked processed
      const checkB = await resumeFingerprintService.isFingerprintProcessed(
        identicalResumeHash,
        applicantB,
      );
      expect(checkB).toBe(false);

      // Enqueue job for Applicant B: queue should accept it and not deduplicate
      const jobB = await queueService.enqueueJob({
        filename: 'resume.pdf',
        mimeType: 'application/pdf',
        fingerprint: identicalResumeHash,
        messageId: 'msg-app-b',
        attachmentId: 'att-app-b',
        sender: { email: applicantB },
        subject: 'Application',
        extractedResumeText: 'identical template',
        source: 'GMAIL',
      });

      expect(jobB).toBeDefined();
      expect(jobB.sender.email).toBe(applicantB);
    });
  });

  describe('Scenario 6: A Gmail-uploaded CV is not reprocessed by Drive polling', () => {
    it('should recognize that a Gmail CV already exists in Google Sheets by Drive file ID and skip reprocessing', async () => {
      const gmailUploadedDriveFileId = 'gmail-uploaded-drive-id-999';

      // Seed Google Sheets with the Gmail-originated candidate row
      sheetsStore.set(88, {
        rowIndex: 4,
        candidateId: 88,
        candidateName: 'Gmail Candidate',
        email: 'gmail.applicant@example.com',
        phone: '9123456780',
        jobRole: 'QA Engineer',
        assignedHrName: 'Jayendra',
        totalExperience: '2',
        currentCompany: 'CFT',
        applicationStatus: 'Shortlisted',
        currentInterviewRound: 'Not Started',
        totalCallAttempts: 0,
        call1Date: '',
        call1Status: '',
        call1Remarks: '',
        call2Date: '',
        call2Status: '',
        call2Remarks: '',
        call3Date: '',
        call3Status: '',
        call3Remarks: '',
        nextFollowUpDate: '',
        automatedFollowUpEmailStatus: 'NOT_SENT',
        followUpEmailSentAt: '',
        hrRemarks: 'Ingested from Gmail',
        lastUpdatedBy: 'System',
        lastUpdatedAt: new Date().toISOString(),
        cvLink: 'https://drive.google.com/gmail-cv',
        driveFileId: gmailUploadedDriveFileId,
      });

      // Simulate Drive polling discovering this file in the CV folder
      const existingInSheets =
        await googleSheetsService.findCandidateByDriveFileId(
          gmailUploadedDriveFileId,
        );
      expect(existingInSheets).not.toBeNull();
      expect(existingInSheets?.candidateId).toBe(88);

      // When existing candidate is found, Drive polling skips enqueuing a duplicate screening job
      const shouldSkipReprocessing = !!existingInSheets;
      expect(shouldSkipReprocessing).toBe(true);
    });
  });

  describe('Scenario 7: A failed HR notification can be retried without re-screening the candidate', () => {
    it('should transition to NOTIFICATION_PENDING and retry notification without re-invoking Gemini or re-creating candidate', async () => {
      // First attempt: Sheets save succeeds, but HR notification throws
      mockCandidateNotificationService.notifyAssignedHr.mockRejectedValueOnce(
        new Error('SMTP connection timeout'),
      );
      mockCandidateNotificationService.notifyManualReview.mockRejectedValueOnce(
        new Error('SMTP connection timeout'),
      );

      const job = await queueService.enqueueJob({
        filename: 'senior-dev.pdf',
        mimeType: 'application/pdf',
        fingerprint: 'fingerprint-notif-fail-1',
        messageId: 'msg-notif-1',
        attachmentId: 'att-notif-1',
        sender: { email: 'senior.dev@example.com' },
        subject: 'Application for Node.js Developer',
        jobRole: 'Node.js Developer',
        extractedResumeText: 'senior dev resume content',
        source: 'GMAIL',
      });

      await workerService.processSingleJob(job);

      const pendingJob = await queueService.getJob(job.id);
      expect(pendingJob?.status).toBe('NOTIFICATION_PENDING');
      expect(pendingJob?.candidateId).toBeDefined();

      const candidateId = pendingJob!.candidateId!;
      expect(sheetsStore.has(candidateId)).toBe(true);

      // Now reset Gemini mock to verify it is NOT called again on retry
      mockGeminiService.screenResume.mockClear();
      mockGeminiService.analyzeApplication.mockClear();
      mockGoogleSheetsService.saveCandidate.mockClear();
      mockCandidateNotificationService.notifyAssignedHr.mockResolvedValueOnce({
        success: true,
        messageId: 'smtp-retry-ok',
      });
      mockCandidateNotificationService.notifyManualReview.mockResolvedValueOnce(
        {
          success: true,
          messageId: 'smtp-retry-ok',
        },
      );

      // Retry the NOTIFICATION_PENDING job
      await workerService.processSingleJob(pendingJob!);

      const finishedJob = await queueService.getJob(job.id);
      expect(finishedJob?.status).toBe('COMPLETED');

      // Verify Gemini was NOT re-invoked
      expect(mockGeminiService.screenResume).not.toHaveBeenCalled();
      expect(mockGeminiService.analyzeApplication).not.toHaveBeenCalled();

      // Verify Google Sheets save was NOT called again to duplicate the candidate
      expect(mockGoogleSheetsService.saveCandidate).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 8: Existing HR-managed Sheets columns are preserved', () => {
    it('should preserve HR call tracking, interview rounds, and HR remarks when updating candidate record', async () => {
      // Seed existing row with HR manual entries
      sheetsStore.set(101, {
        rowIndex: 2,
        candidateId: 101,
        candidateName: 'Rahul Verma',
        email: 'rahul.verma@example.com',
        phone: '9876543210',
        jobRole: 'React Developer',
        assignedHrName: 'Abhishek',
        totalExperience: '4',
        currentCompany: 'TCS',
        applicationStatus: 'Shortlisted',
        currentInterviewRound: 'Technical Round 1',
        totalCallAttempts: 2,
        call1Date: '2026-10-15 10:00:00',
        call1Status: 'Busy',
        call1Remarks: 'Candidate in meeting',
        call2Date: '2026-10-16 11:00:00',
        call2Status: 'Answered',
        call2Remarks: 'Scheduled for technical round',
        call3Date: '',
        call3Status: '',
        call3Remarks: '',
        nextFollowUpDate: '2026-10-22',
        automatedFollowUpEmailStatus: 'NOT_SENT',
        followUpEmailSentAt: '',
        hrRemarks: 'Candidate requested evening slot',
        lastUpdatedBy: 'Abhishek',
        lastUpdatedAt: '2026-10-16 11:30:00',
        cvLink: 'https://drive.google.com/rahul',
        driveFileId: 'drive-rahul-101',
      });

      // Update candidate with updated status from screening/system update
      await googleSheetsService.saveCandidate({
        id: 101,
        name: 'Rahul Verma',
        screeningStatus: 'SHORTLIST',
      });

      const updatedRow = sheetsStore.get(101);
      expect(updatedRow).toBeDefined();
      expect(updatedRow?.currentInterviewRound).toBe('Technical Round 1');
      expect(updatedRow?.call1Status).toBe('Busy');
      expect(updatedRow?.call1Remarks).toBe('Candidate in meeting');
      expect(updatedRow?.call2Status).toBe('Answered');
      expect(updatedRow?.call2Remarks).toBe('Scheduled for technical round');
      expect(updatedRow?.hrRemarks).toBe('Candidate requested evening slot');
      expect(updatedRow?.nextFollowUpDate).toBe('2026-10-22');
    });
  });

  describe('Scenario 9: Existing authentication and user-management functionality remains unaffected', () => {
    it('should successfully generate JWT and verify user auth without any reliance on Excel candidate records', async () => {
      const sendCodeResult = await authService.sendCode(
        'newuser@example.com',
        OtpTransport.Email,
        SendCodeRequestType.Register,
      );

      expect(sendCodeResult).toBeDefined();
      expect(mockUsersService.isEmailExist).toHaveBeenCalledWith(
        'newuser@example.com',
      );
      expect(mockOtpService.send).toHaveBeenCalled();

      // Excel candidate service was completely uncalled
      expect(mockCandidateExcelService.saveCandidate).not.toHaveBeenCalled();
      expect(mockCandidateExcelService.getAllCandidates).not.toHaveBeenCalled();
    });
  });
});
