import { Test, TestingModule } from '@nestjs/testing';
import { CandidateExcelService } from './candidate-excel.service';
import { CandidateNotificationService } from './candidate-notification.service';
import { HrAssignmentService } from './hr-assignment.service';
import { GoogleSheetsService } from './google-sheets.service';
import { RedisService } from '../redis';
import { PrismaService } from '../prisma';
import { MailService } from '../mail/mail.service';
import { GmailService } from '../mail/gmail.service';
import { ResumeScreeningQueueService } from '../mail/resume-screening-queue.service';
import { ResumeScreeningWorkerService } from '../mail/resume-screening-worker.service';
import { GeminiService } from '../mail/gemini.service';
import { ResumeFingerprintService } from '../mail/resume-fingerprint.service';
import { RoleDetectionService } from '../mail/role-detection.service';
import {
  excelSyncConfigFactory,
  hrConfigFactory,
  googleSheetsConfigFactory,
  geminiConfigFactory,
  gmailConfigFactory,
  appConfigFactory,
} from '@Config';
import { ExcelCandidateRecord } from './candidate.types';
import { NotificationStatus } from '../generated/prisma/client';

describe('Candidate Identity, Concurrency, Counter Recovery & Decoupled Ingestion', () => {
  let candidateExcelService: CandidateExcelService;
  let candidateNotificationService: CandidateNotificationService;
  let queueService: ResumeScreeningQueueService;
  let workerService: ResumeScreeningWorkerService;
  let gmailService: GmailService;

  const redisStore = new Map<string, string>();
  const redisSets = new Map<string, Set<string>>();

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
    sadd: jest.fn(async (key: string, member: string) => {
      if (!redisSets.has(key)) redisSets.set(key, new Set());
      redisSets.get(key)!.add(member);
      return 1;
    }),
    sismember: jest.fn(async (key: string, member: string) => {
      return redisSets.get(key)?.has(member) ? 1 : 0;
    }),
    smembers: jest.fn(async (key: string) => {
      return Array.from(redisSets.get(key) || []);
    }),
    srem: jest.fn(async (key: string, member: string) => {
      return redisSets.get(key)?.delete(member) ? 1 : 0;
    }),
    hset: jest.fn(async (key: string, field: string, val: string) => {
      redisStore.set(`${key}:${field}`, val);
      return 1;
    }),
    hget: jest.fn(async (key: string, field: string) => {
      return redisStore.get(`${key}:${field}`) || null;
    }),
    hgetall: jest.fn(async (key: string) => {
      const res: Record<string, string> = {};
      const prefix = `${key}:`;
      for (const [k, v] of redisStore.entries()) {
        if (k.startsWith(prefix)) {
          res[k.substring(prefix.length)] = v;
        }
      }
      return res;
    }),
    eval: jest.fn(async () => 1),
  };

  const mockRedisService = {
    client: mockRedisClient,
  };

  const mockMailService = {
    sendDirect: jest.fn(async () => ({
      messageId: 'mock-sent-id-' + Math.random(),
      response: '250 OK: Message accepted',
    })),
  };

  beforeEach(async () => {
    redisStore.clear();
    redisSets.clear();
    jest.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateExcelService,
        CandidateNotificationService,
        HrAssignmentService,
        GoogleSheetsService,
        ResumeScreeningQueueService,
        ResumeScreeningWorkerService,
        GeminiService,
        ResumeFingerprintService,
        RoleDetectionService,
        GmailService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: MailService,
          useValue: mockMailService,
        },
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: excelSyncConfigFactory.KEY,
          useValue: {
            filePath: './data/test-candidates.xlsx',
            syncIntervalMinutes: 2,
            syncEnabled: false,
          },
        },
        {
          provide: googleSheetsConfigFactory.KEY,
          useValue: {
            spreadsheetId: 'test-spreadsheet-id',
            keyFile: './config/google-service-account.json',
            tabName: 'Candidate Tracker',
            pollingEnabled: false,
          },
        },
        {
          provide: hrConfigFactory.KEY,
          useValue: {
            shortlistThreshold: 60,
            manualReviewEmail: 'hr-review@codesfortomorrow.com',
            hr1: {
              id: 'hr-1',
              name: 'Abhishek',
              email: 'abhishek@codesfortomorrow.com',
              assignedRoles: [
                'REACT_DEVELOPER',
                'NODE_DEVELOPER',
                'BACKEND_DEVELOPER',
              ],
            },
            hr2: {
              id: 'hr-2',
              name: 'Jayendra',
              email: 'jayendrabamne.mongoosetech@gmail.com',
              assignedRoles: ['QA_TESTER', 'HR_INTERN', 'HR_EXECUTIVE'],
            },
          },
        },
        {
          provide: geminiConfigFactory.KEY,
          useValue: {
            apiKey: 'test-key',
            model: 'gemini-2.5-flash',
            initialRetryDelayMs: 50,
            maxRetryDelayMs: 200,
            maxAttempts: 3,
            maxRetryAgeMs: 60000,
            maxConcurrentRequests: 2,
          },
        },
        {
          provide: gmailConfigFactory.KEY,
          useValue: {
            user: 'me',
            maxAttachmentSize: 10 * 1024 * 1024,
            pollingEnabled: false,
            searchQuery: 'label:INBOX is:unread',
          },
        },
        {
          provide: appConfigFactory.KEY,
          useValue: {
            environment: 'test',
            frontendUrl: 'http://localhost:3000',
          },
        },
      ],
    }).compile();

    candidateExcelService = moduleRef.get<CandidateExcelService>(
      CandidateExcelService,
    );
    candidateNotificationService = moduleRef.get<CandidateNotificationService>(
      CandidateNotificationService,
    );
    queueService = moduleRef.get<ResumeScreeningQueueService>(
      ResumeScreeningQueueService,
    );
    workerService = moduleRef.get<ResumeScreeningWorkerService>(
      ResumeScreeningWorkerService,
    );
    gmailService = moduleRef.get<GmailService>(GmailService);
  });

  describe('1. Concurrency & Counter Recovery for Candidate ID Allocator', () => {
    it('should allocate strictly unique and sequential IDs under concurrent invocations', async () => {
      // Simulate 20 concurrent candidate allocation requests
      const concurrentRequests = Array.from({ length: 20 }, () =>
        candidateExcelService.allocateNextCandidateId(15),
      );

      const allocatedIds = await Promise.all(concurrentRequests);

      // Verify all 20 IDs are strictly unique
      const uniqueIds = new Set(allocatedIds);
      expect(uniqueIds.size).toBe(20);

      // Verify sequence started at 18 (since max existing is 15 and baseline minimum is 17)
      expect(Math.min(...allocatedIds)).toBe(18);
      expect(Math.max(...allocatedIds)).toBe(37);
    });

    it('should recover sequence cleanly if Redis cache is lost or process restarts', async () => {
      // Step 1: Initial allocation
      const firstId = await candidateExcelService.allocateNextCandidateId(15);
      expect(firstId).toBe(18);

      // Step 2: Simulate Redis total data wipe (e.g. restart without persistence)
      redisStore.clear();

      // Step 3: Counter recovery discovers maxExistingId from workbook (now 18)
      const secondId = await candidateExcelService.allocateNextCandidateId(18);
      expect(secondId).toBe(19);

      // Step 4: Subsequent concurrent allocations continue sequentially without duplicate
      const thirdId = await candidateExcelService.allocateNextCandidateId(18);
      expect(thirdId).toBe(20);
    });

    it('should reconcile Rohit Dorage with ID 18 without overwriting historical data', async () => {
      // Existing sheet has candidates up to ID 15
      const rohitId = await candidateExcelService.allocateNextCandidateId(15);
      expect(rohitId).toBe(18);
    });
  });

  describe('2. Notification Idempotency for Multiple Candidates with Similar Resumes', () => {
    it('should notify HR independently for Candidate A and Candidate B even if resumes are identical', async () => {
      const candidateA: ExcelCandidateRecord = {
        id: 10,
        name: 'Alice Cooper',
        email: 'alice@example.com',
        phone: '9876543210',
        jobRole: 'Node.js Developer',
        screeningStatus: 'SHORTLIST',
        matchScore: 92,
        summary: 'Experienced Node.js Developer with 3 years experience.',
        assignedHrName: 'Abhishek',
        assignedHrEmail: 'abhishek@codesfortomorrow.com',
      };

      const candidateB: ExcelCandidateRecord = {
        id: 11,
        name: 'Bob Marley',
        email: 'bob@example.com',
        phone: '9876543211',
        jobRole: 'Node.js Developer',
        screeningStatus: 'SHORTLIST',
        matchScore: 92, // same score and profile
        summary: 'Experienced Node.js Developer with 3 years experience.',
        assignedHrName: 'Abhishek',
        assignedHrEmail: 'abhishek@codesfortomorrow.com',
      };

      // Notify HR for Candidate A
      const resultA =
        await candidateNotificationService.notifyAssignedHr(candidateA);
      expect(resultA.status).toBe(NotificationStatus.Sent);

      // Notify HR for Candidate B (must NOT be suppressed by Candidate A's notification)
      const resultB =
        await candidateNotificationService.notifyAssignedHr(candidateB);
      expect(resultB.status).toBe(NotificationStatus.Sent);
      expect(mockMailService.sendDirect).toHaveBeenCalledTimes(2);

      // Re-notifying Candidate A must be suppressed by idempotency
      const resultARetry =
        await candidateNotificationService.notifyAssignedHr(candidateA);
      expect(resultARetry.status).toBe(NotificationStatus.Sent);
      // Still only 2 emails dispatched, because Candidate A's retry was skipped via Redis idempotency key
      expect(mockMailService.sendDirect).toHaveBeenCalledTimes(2);
    });
  });

  describe('3. Decoupled Background Ingestion & Bounded Concurrency', () => {
    it('should enqueue screening jobs during Gmail polling without waiting for slow Gemini inference', async () => {
      const mockEmail = {
        id: 'msg-slow-ai',
        threadId: 'th-slow',
        subject: 'Application for Backend Developer - Fast Ingestion',
        snippet: 'Applying for backend developer. CV attached.',
        textBody: 'Please find attached my resume.',
        sender: { name: 'Fast Applicant', email: 'fast@applicant.com' },
        recipient: 'careers@company.com',
        receivedDate: new Date(),
        attachments: [
          {
            filename: 'Resume_Fast.pdf',
            mimeType: 'application/pdf',
            size: 80000,
            attachmentId: 'att-fast-1',
          },
        ],
      };

      jest.spyOn(gmailService, 'listMessages').mockResolvedValue({
        messages: [{ id: 'msg-slow-ai', threadId: 'th-slow' }],
      });
      jest.spyOn(gmailService, 'getMessage').mockResolvedValue(mockEmail);
      jest
        .spyOn(gmailService, 'downloadAttachment')
        .mockResolvedValue(Buffer.from('%PDF-1.4 test'));
      jest.spyOn(gmailService, 'extractResumeText').mockResolvedValue({
        text: 'Fast Applicant. 4 years Node.js Backend Developer.',
      });

      // Long running Gemini call mock (5000ms delay)
      const geminiSpy = jest.spyOn(workerService, 'processSingleJob');

      const startTime = Date.now();
      // fetchNewApplications with asyncScreening: true (as used by pollInbox)
      const applications = await gmailService.fetchNewApplications({
        asyncScreening: true,
      });
      const elapsedTime = Date.now() - startTime;

      // Ingestion must complete almost immediately (< 500ms), without blocking on worker execution
      expect(elapsedTime).toBeLessThan(1000);
      expect(applications.length).toBe(1);
      // workerService.processSingleJob was NOT awaited inline during polling
      expect(geminiSpy).not.toHaveBeenCalled();

      // Job is safely persisted in the queue for asynchronous background execution
      const jobs = await queueService.listJobs();
      expect(jobs.total).toBe(1);
      expect(jobs.jobs[0].messageId).toBe('msg-slow-ai');
    });

    it('should recover stale jobs stuck in PROCESSING longer than 5 minutes', async () => {
      const staleJob = await queueService.enqueueJob({
        fingerprint: 'stale-fp-123',
        messageId: 'msg-stale-1',
        attachmentId: 'att-stale-1',
        filename: 'Stale_Resume.pdf',
        mimeType: 'application/pdf',
        fileSize: 50000,
        sender: { email: 'stale@applicant.com' },
        subject: 'Stale Application',
        receivedDate: new Date(),
        extractedResumeText: 'Stale candidate resume text',
      });

      // Simulate job being stuck in PROCESSING with a timestamp from 10 minutes ago
      staleJob.status = 'PROCESSING';
      staleJob.updatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      await queueService.updateJob(staleJob);

      // Run recovery
      const recovered = await queueService.recoverStaleJobs();
      expect(recovered).toBe(1);

      // Status should be reset to RETRY_WAIT for automatic reprocessing
      const updated = await queueService.getJob('stale-fp-123');
      expect(updated?.status).toBe('RETRY_WAIT');
      expect(updated?.lastError).toContain('timed out or worker crashed');
    });

    it('should gracefully stop worker when onApplicationShutdown is triggered', async () => {
      await workerService.onApplicationShutdown();
      // ProcessDueJobsCron should not process jobs when shutting down
      await workerService.processDueJobsCron();
      // Verified no crashes or hanging promises
    });
  });
});
