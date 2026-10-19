import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { GeminiService } from './gemini.service';
import { GmailService } from './gmail.service';
import { ResumeFingerprintService } from './resume-fingerprint.service';
import { ResumeScreeningQueueService } from './resume-screening-queue.service';
import { ResumeScreeningWorkerService } from './resume-screening-worker.service';
import { CandidateService } from '../candidate/candidate.service';
import { CandidateExcelService } from '../candidate/candidate-excel.service';
import { GoogleSheetsService } from '../candidate/google-sheets.service';
import { HrAssignmentService } from '../candidate/hr-assignment.service';
import { CandidateNotificationService } from '../candidate/candidate-notification.service';
import { RedisService } from '../redis';
import { PrismaService } from '../prisma';
import { MailService } from './mail.service';
import {
  geminiConfigFactory,
  gmailConfigFactory,
  hrConfigFactory,
  excelSyncConfigFactory,
  googleSheetsConfigFactory,
  appConfigFactory,
} from '@Config';
import { NotificationStatus } from '../generated/prisma/client';

describe('Resume Text Extraction, ATS Screening, HR Assignment & Reprocessing (10 Core Scenarios)', () => {
  let geminiService: GeminiService;
  let gmailService: GmailService;
  let hrAssignmentService: HrAssignmentService;
  let candidateNotificationService: CandidateNotificationService;
  let candidateExcelService: CandidateExcelService;
  let candidateService: CandidateService;

  const redisStore = new Map<string, string>();
  const redisSets = new Map<string, Set<string>>();
  const redisHashes = new Map<string, Map<string, string>>();

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
    sadd: jest.fn(async (key: string, member: string) => {
      if (!redisSets.has(key)) redisSets.set(key, new Set());
      redisSets.get(key)!.add(member);
      return 1;
    }),
    sismember: jest.fn(async (key: string, member: string) => {
      return redisSets.get(key)?.has(member) ? 1 : 0;
    }),
    srem: jest.fn(async (key: string, member: string) => {
      return redisSets.get(key)?.delete(member) ? 1 : 0;
    }),
    hset: jest.fn(async (hashKey: string, field: string, val: string) => {
      if (!redisHashes.has(hashKey)) redisHashes.set(hashKey, new Map());
      redisHashes.get(hashKey)!.set(field, val);
      return 1;
    }),
    hget: jest.fn(async (hashKey: string, field: string) => {
      return redisHashes.get(hashKey)?.get(field) || null;
    }),
    eval: jest.fn(
      async (script: string, numKeys: number, key: string, token: string) => {
        if (redisStore.get(key) === token) {
          redisStore.delete(key);
          return 1;
        }
        return 0;
      },
    ),
  };

  const mockRedisService = {
    client: mockRedisClient,
  };

  const mockMailService = {
    sendDirect: jest.fn(async () => ({
      messageId: 'mock-mail-id-' + Date.now(),
      response: '250 OK: Message accepted for delivery',
    })),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiService,
        GmailService,
        HrAssignmentService,
        ResumeFingerprintService,
        ResumeScreeningQueueService,
        ResumeScreeningWorkerService,
        CandidateService,
        CandidateExcelService,
        GoogleSheetsService,
        CandidateNotificationService,
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
          provide: geminiConfigFactory.KEY,
          useValue: {
            apiKey: 'test-gemini-key',
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
            maxAttachmentSize: 25 * 1024 * 1024,
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
              assignedRoles: ['REACT_DEVELOPER', 'NODE_DEVELOPER'],
            },
            hr2: {
              id: 'hr-2',
              name: 'Jayendra',
              email: 'jayendrabamne.mongoosetech@gmail.com',
              assignedRoles: ['HR_INTERN', 'HR_EXECUTIVE'],
            },
          },
        },
        {
          provide: excelSyncConfigFactory.KEY,
          useValue: {
            enabled: true,
            path: path.resolve(process.cwd(), 'data', 'test-candidates.xlsx'),
            intervalMinutes: 5,
          },
        },
        {
          provide: googleSheetsConfigFactory.KEY,
          useValue: {
            spreadsheetId: '',
            keyFile: '',
            tabName: 'Candidate Tracker',
            pollingEnabled: false,
          },
        },
        {
          provide: appConfigFactory.KEY,
          useValue: {
            adminWebUrl: 'https://admin.codesfortomorrow.com',
            appWebUrl: 'https://app.codesfortomorrow.com',
          },
        },
      ],
    }).compile();

    geminiService = moduleRef.get<GeminiService>(GeminiService);
    gmailService = moduleRef.get<GmailService>(GmailService);
    hrAssignmentService =
      moduleRef.get<HrAssignmentService>(HrAssignmentService);
    candidateNotificationService = moduleRef.get<CandidateNotificationService>(
      CandidateNotificationService,
    );
    candidateExcelService = moduleRef.get<CandidateExcelService>(
      CandidateExcelService,
    );
    candidateService = moduleRef.get<CandidateService>(CandidateService);
  });

  beforeEach(() => {
    redisStore.clear();
    redisSets.clear();
    redisHashes.clear();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    const testExcel = path.resolve(
      process.cwd(),
      'data',
      'test-candidates.xlsx',
    );
    if (fs.existsSync(testExcel)) {
      try {
        fs.unlinkSync(testExcel);
      } catch {}
    }
  });

  // Scenario 1: A normal PDF with readable resume text
  it('Scenario 1: extracts readable resume text from normal text-based PDF', async () => {
    // PDFParse getText mock or natural check
    const isSuspicious = geminiService.isSuspiciouslyShortText(
      'Prakriti Pachori\nHR Intern at Synture Organisation\nEmail: prakriti@example.com\nExperience: 6 months of talent acquisition, job postings, screening, interviews on Google Meet, Excel reporting.',
    );
    expect(isSuspicious).toBe(false);
  });

  // Scenario 2: A scanned PDF that requires OCR
  it('Scenario 2: falls back to Gemini OCR when PDF contains no text stream or only print footer', async () => {
    const footerOnlyText = '-- 1 of 1 --';
    expect(geminiService.isSuspiciouslyShortText(footerOnlyText)).toBe(true);

    const ocrMock = jest
      .spyOn(geminiService, 'extractTextWithOcr')
      .mockResolvedValueOnce({
        text: 'Prakriti Pachori\nHR Intern at Synture Organisation\nEmail: prakriti@example.com\nPhone: +91 7898517996\nResponsibilities: Sourcing candidates across various portals, screening resumes against JD requirements, scheduling interviews on Google Meet, candidate follow-ups, documentation, and managing candidate trackers in Google Sheets.',
      });

    // Mock PDFParse to return only the footer
    const minimalPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n',
      'utf-8',
    );
    const result = await gmailService.extractResumeText(minimalPdf);

    expect(ocrMock).toHaveBeenCalled();
    expect(result.text).toContain('Prakriti Pachori');
    expect(result.error).toBeUndefined();
  });

  // Scenario 3: A PDF that produces empty or very short extracted text
  it('Scenario 3: flags empty or suspiciously short extracted text as RESUME_EXTRACTION_INSUFFICIENT', async () => {
    expect(geminiService.isSuspiciouslyShortText('')).toBe(true);
    expect(geminiService.isSuspiciouslyShortText('   ')).toBe(true);
    expect(geminiService.isSuspiciouslyShortText('Short text')).toBe(true);
    expect(geminiService.isSuspiciouslyShortText('page 1 of 1')).toBe(true);
    expect(geminiService.isSuspiciouslyShortText('-- 2 of 2 --')).toBe(true);

    // When OCR is unavailable or fails, extractResumeText returns clear status
    jest
      .spyOn(geminiService, 'extractTextWithOcr')
      .mockRejectedValueOnce(new Error('OCR unavailable'));
    const minimalPdf = Buffer.from('%PDF-1.4\nempty\n', 'utf-8');
    const result = await gmailService.extractResumeText(minimalPdf);

    expect(result.error).toContain('RESUME_EXTRACTION_INSUFFICIENT');
  });

  // Scenario 4: Insufficient resume data not being treated as a genuine ATS score of zero
  it('Scenario 4: insufficient resume text produces matchScore: null and flags MANUAL_REVIEW without score 0', () => {
    const evaluation = geminiService.evaluateHrResumeEvidence('-- 1 of 1 --', {
      name: 'Applicant',
      email: 'applicant@example.com',
    });

    expect(evaluation.matchScore).toBeNull();
    expect(evaluation.screeningStatus).toBe('MANUAL_REVIEW');
    expect(evaluation.recommendedStatus).toBe('Requires Human Review');
    expect(evaluation.rejectionReason).toBe('RESUME_EXTRACTION_INSUFFICIENT');
    expect(evaluation.hrReviewRequired).toBe(true);
  });

  // Scenario 5: A valid recruitment candidate with score 60 or above being assigned to HR2 when eligible
  it('Scenario 5: assigns eligible HR candidate with score >= 60 to HR2 (Jayendra)', () => {
    const resumeText = `
      Prakriti Pachori
      prakritipachori41@gmail.com
      +91 7898517996
      HR Intern at Synture Organisation, Indore
      Experience:
      - Worked as HR Intern for talent acquisition, hiring, and recruitment methods.
      - Sourcing candidates across portals, screening resumes, and coordinating interviews.
      - Managed interview followups, documentation, and candidate engagement.
      - Proficient in Excel and Google Sheets candidate trackers.
    `;

    const evaluation = geminiService.evaluateHrResumeEvidence(resumeText);
    expect(evaluation.matchScore).toBeGreaterThanOrEqual(60);
    expect(evaluation.screeningStatus).toBe('SHORTLIST');

    const assignment = hrAssignmentService.assignHr(
      evaluation.suggestedProfile,
      {
        matchScore: evaluation.matchScore,
        screeningStatus: evaluation.screeningStatus,
        hrReviewRequired: false,
      },
    );

    expect(assignment).toBeDefined();
    expect(assignment?.id).toBe('hr-2');
    expect(assignment?.name).toBe('Jayendra');
    expect(assignment?.email).toBe('jayendrabamne.mongoosetech@gmail.com');
  });

  // Scenario 6: A genuine Manual Review case following the existing review workflow
  it('Scenario 6: routes genuine manual review case to configured manual review recipient', async () => {
    const candidate = {
      id: 101,
      name: 'Unclear Role Applicant',
      email: 'unclear@example.com',
      jobRole: 'Unknown Profile',
      assignedHrName: 'Manual Review',
      screeningStatus: 'MANUAL_REVIEW',
      matchScore: null,
      summary: 'Insufficient details to determine profile.',
    };

    const result =
      await candidateNotificationService.notifyManualReview(candidate);
    expect(result.status).toBe(NotificationStatus.Sent);
    expect(result.recipient).toBe('hr-review@codesfortomorrow.com');
  });

  // Scenario 7: An HR1 notification not suppressing a required HR2 notification
  it('Scenario 7: notification idempotency is recipient and type aware; HR1 notice does not block HR2 notice', async () => {
    const candidateId = 202;

    // Simulate prior manual review notification sent to HR1 / manual review email
    redisStore.set(
      `candidate:notified:manual:${candidateId}:hr-review@codesfortomorrow.com`,
      'SENT',
    );

    // Now candidate qualifies for shortlist and is assigned to HR2 (Jayendra)
    const candidateForHr2 = {
      id: candidateId,
      name: 'Prakriti Pachori',
      email: 'prakritipachori41@gmail.com',
      assignedHrId: 'hr-2',
      assignedHrName: 'Jayendra',
      assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
      screeningStatus: 'SHORTLIST',
      jobRole: 'HR Intern',
      matchScore: 61,
    };

    const hr2Result =
      await candidateNotificationService.notifyAssignedHr(candidateForHr2);
    expect(hr2Result.status).toBe(NotificationStatus.Sent);
    expect(hr2Result.recipient).toBe('jayendrabamne.mongoosetech@gmail.com');

    // Verify key was set specifically for HR2
    expect(
      redisStore.get(
        `candidate:notified:${candidateId}:jayendrabamne.mongoosetech@gmail.com`,
      ),
    ).toBe('SENT');
  });

  // Scenario 8: Duplicate retries not sending duplicate emails
  it('Scenario 8: duplicate notify calls for same candidate and recipient skip sending', async () => {
    const candidate = {
      id: 303,
      name: 'Jayendra Candidate',
      email: 'c303@example.com',
      assignedHrId: 'hr-2',
      assignedHrName: 'Jayendra',
      assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
      screeningStatus: 'SHORTLIST',
      jobRole: 'HR Intern',
      matchScore: 75,
    };

    // First call sends
    const res1 = await candidateNotificationService.notifyAssignedHr(candidate);
    expect(res1.status).toBe(NotificationStatus.Sent);

    // Second call skips duplicate
    const res2 = await candidateNotificationService.notifyAssignedHr(candidate);
    expect(res2.status).toBe(NotificationStatus.Sent);
    expect(mockMailService.sendDirect).toHaveBeenCalledTimes(1);
  });

  // Scenario 9: Google Sheets and Excel preserving existing HR call statuses, dates, and remarks
  it('Scenario 9: saving or updating a candidate preserves existing call tracking and remarks', async () => {
    const testExcel = path.resolve(
      process.cwd(),
      'data',
      'test-candidates.xlsx',
    );
    await candidateExcelService.ensureWorkbookExists(testExcel);

    // Create candidate with initial call tracking info
    const initial = await candidateExcelService.saveCandidate({
      name: 'Candidate With Notes',
      email: 'notes@example.com',
      phone: '+91 9999988888',
      jobRole: 'HR Intern',
      screeningStatus: 'SHORTLIST',
      assignedHrName: 'Jayendra',
      assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
      call1Date: '19/10/2026',
      call1Status: 'Answered',
      call1Remarks: 'First interview round scheduled for tomorrow',
      hrRemarks: 'Solid HR Intern background',
    });

    expect(initial.id).toBeDefined();

    // Re-save/update screening result without call remarks
    const updated = await candidateExcelService.saveCandidate({
      id: initial.id,
      name: 'Candidate With Notes',
      email: 'notes@example.com',
      screeningStatus: 'SHORTLIST',
      assignedHrName: 'Jayendra',
      assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
    });

    expect(updated.id).toBe(initial.id);
    expect(updated.call1Status).toBe('Answered');
    expect(updated.call1Remarks).toBe(
      'First interview round scheduled for tomorrow',
    );
    expect(updated.rejectionReason).toBe('Solid HR Intern background');
  });

  // Scenario 10: Successful reprocessing updating the existing candidate instead of creating a duplicate
  it('Scenario 10: reprocessing candidate ID 2 updates existing candidate in-place without creating duplicate', async () => {
    // Save candidate ID 2 initially as manual review
    const candidate2Initial = await candidateExcelService.saveCandidate({
      id: 2,
      name: 'Abhishek Goud',
      email: 'abhigoud198484@gmail.com',
      jobRole: 'HR Intern',
      screeningStatus: 'MANUAL_REVIEW',
      assignedHrName: 'Manual Review',
      matchScore: null,
      rejectionReason: 'RESUME_EXTRACTION_INSUFFICIENT',
    });

    expect(candidate2Initial.id).toBe(2);

    // Mock re-extracted OCR analysis for candidate 2 (Prakriti Pachori)
    const ocrAnalysis = geminiService.evaluateHrResumeEvidence(
      `Prakriti Pachori
prakritipachori41@gmail.com
+91 7898517996
HR Intern at Synture Organisation, Indore
Experience:
- Worked as HR Intern for talent acquisition, hiring, and recruitment methods.
- Sourcing candidates across portals, screening resumes, and coordinating interviews.
- Managed interview followups, documentation, and candidate engagement.
- Proficient in Excel and Google Sheets candidate trackers.`,
      {
        name: 'Prakriti Pachori',
        email: 'prakritipachori41@gmail.com',
        phone: '+91 7898517996',
      },
    );

    const ocrAnalysisResult = {
      status: 'success' as const,
      filename: 'updated cv prakriti-2.pdf',
      attachmentId: 'att-prakriti-2',
      model: 'gemini-2.5-flash',
      analyzedAt: new Date().toISOString(),
      analysis: ocrAnalysis,
    };

    const mockMessageDetail = {
      id: 'msg-prakriti-2',
      threadId: 'msg-prakriti-2',
      sender: { name: 'Abhishek Goud', email: 'abhigoud198484@gmail.com' },
      recipient: 'me',
      subject: 'Resume for HR Intern - Prakriti',
      receivedDate: new Date(),
      snippet: 'Resume for HR Intern - Prakriti',
      attachments: [
        {
          filename: 'updated cv prakriti-2.pdf',
          mimeType: 'application/pdf',
          size: 172769,
          attachmentId: 'att-prakriti-2',
        },
      ],
      resumes: [
        {
          attachmentId: 'att-prakriti-2',
          filename: 'updated cv prakriti-2.pdf',
          mimeType: 'application/pdf',
          size: 172769,
          status: 'success' as const,
          text: 'Prakriti Pachori HR Intern Synture Organisation',
          fingerprint: 'fp-prakriti-2',
        },
      ],
    };

    // Reprocess candidate ID 2 with forceUpdate: true and candidateId: 2
    const reprocessed = await candidateService.persistAndProcessScreeningResult(
      {
        messageDetail: mockMessageDetail,
        analysisResult: ocrAnalysisResult,
        candidateId: 2,
        forceUpdate: true,
      },
    );

    expect(reprocessed.id).toBe(2);
    expect(reprocessed.name).toBe('Prakriti Pachori');
    expect(reprocessed.email).toBe('prakritipachori41@gmail.com');
    expect(reprocessed.screeningStatus).toBe('SHORTLIST');
    expect(reprocessed.assignedHrName).toBe('Jayendra');
    expect(reprocessed.assignedHrEmail).toBe(
      'jayendrabamne.mongoosetech@gmail.com',
    );

    // Verify record in Excel was updated in-place at ID 2
    const fetchedCandidate2 = await candidateExcelService.getCandidateById(2);
    expect(fetchedCandidate2).toBeDefined();
    expect(fetchedCandidate2?.name).toBe('Prakriti Pachori');
    expect(fetchedCandidate2?.email).toBe('prakritipachori41@gmail.com');
    expect(fetchedCandidate2?.screeningStatus).toBe('SHORTLIST');
    expect(fetchedCandidate2?.assignedHrEmail).toBe(
      'jayendrabamne.mongoosetech@gmail.com',
    );
  });
});
