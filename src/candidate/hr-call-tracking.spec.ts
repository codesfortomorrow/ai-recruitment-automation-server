import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CandidateService } from './candidate.service';
import { CandidateExcelService } from './candidate-excel.service';
import { GoogleSheetsService } from './google-sheets.service';
import { HrAssignmentService } from './hr-assignment.service';
import { CandidateNotificationService } from './candidate-notification.service';
import { RedisService } from '../redis';
import { GmailService } from '../mail/gmail.service';
import { MailService } from '../mail/mail.service';
import { ResumeFingerprintService } from '../mail/resume-fingerprint.service';
import { hrConfigFactory, mailConfigFactory } from '@Config';
import { ExcelCandidateRecord } from './candidate.types';

describe('HR Call-Attempt Tracking and Automated Follow-up Email System', () => {
  let candidateService: CandidateService;
  let mockCandidateExcelService: any;
  let mockGoogleSheetsService: any;
  let mockGmailService: any;
  let mockMailService: any;
  let mockRedisClient: any;

  const mockHrConfig = {
    hr1: {
      id: 'hr-1',
      name: 'Aastha',
      email: 'aasthanegi.mongoosetech@gmail.com',
    },
    hr2: {
      id: 'hr-2',
      name: 'Jayendra',
      email: 'jayendrabamne.mongoosetech@gmail.com',
    },
    manualReviewEmail: 'abhishekgoud198484@gmial.com',
  };

  const mockMailConfig = {
    sender: 'recruitment@codesfortomorrow.com',
  };

  // In-memory candidate database for tests
  let candidateDb: Map<number, ExcelCandidateRecord>;
  let redisStore: Map<string, string>;

  beforeEach(async () => {
    candidateDb = new Map<number, ExcelCandidateRecord>();
    redisStore = new Map<string, string>();

    // Initial mock candidates
    candidateDb.set(101, {
      id: 101,
      name: 'Rahul Verma',
      email: 'rahul.verma@example.com',
      phone: '9876543210',
      jobRole: 'React Developer',
      assignedHrName: 'Aastha',
      assignedHrEmail: 'aasthanegi.mongoosetech@gmail.com',
      screeningStatus: 'SHORTLIST',
      applicationStatus: 'Shortlisted',
      matchScore: 85,
      summary: 'Strong React developer',
      callCount: 0,
      lastCallStatus: 'Not Called',
      automatedFollowUpEmailStatus: 'NOT_SENT',
    });

    candidateDb.set(102, {
      id: 102,
      name: 'Priya Sharma',
      email: 'priya.sharma@example.com',
      phone: '9876543211',
      jobRole: 'QA Tester',
      assignedHrName: 'Jayendra',
      assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
      screeningStatus: 'SHORTLIST',
      applicationStatus: 'Shortlisted',
      matchScore: 82,
      summary: 'Experienced QA Tester',
      callCount: 0,
      lastCallStatus: 'Not Called',
      automatedFollowUpEmailStatus: 'NOT_SENT',
    });

    candidateDb.set(103, {
      id: 103,
      name: 'Amit Patel',
      email: 'invalid-email-format',
      phone: '9876543212',
      jobRole: 'Node Developer',
      assignedHrName: 'Aastha',
      assignedHrEmail: 'aasthanegi.mongoosetech@gmail.com',
      screeningStatus: 'SHORTLIST',
      applicationStatus: 'Shortlisted',
      matchScore: 78,
      summary: 'Node Developer with invalid email',
      callCount: 0,
      lastCallStatus: 'Not Called',
      automatedFollowUpEmailStatus: 'NOT_SENT',
    });

    mockRedisClient = {
      get: jest.fn().mockImplementation(async (key: string) => {
        return redisStore.get(key) || null;
      }),
      set: jest.fn().mockImplementation(async (...args: any[]) => {
        const [key, value, ...rest] = args;
        if (rest.includes('NX') && redisStore.has(key)) {
          return null; // Key already exists, NX fails
        }
        redisStore.set(key, String(value));
        return 'OK';
      }),
      del: jest.fn().mockImplementation(async (key: string) => {
        return redisStore.delete(key) ? 1 : 0;
      }),
      eval: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
    };

    mockCandidateExcelService = {
      getCandidateById: jest.fn().mockImplementation(async (id: number) => {
        return candidateDb.get(id) || null;
      }),
      saveCandidate: jest.fn().mockImplementation(async (input: any) => {
        const existing = candidateDb.get(input.id) || ({} as any);
        const updated = { ...existing, ...input };
        candidateDb.set(input.id, updated);
        return updated;
      }),
      getDashboardStats: jest.fn().mockResolvedValue({ total: 3 }),
      findCandidates: jest.fn().mockResolvedValue({ data: [] }),
    };

    mockGoogleSheetsService = {
      isConfigured: jest.fn().mockReturnValue(true),
      getPollingConfig: jest.fn().mockReturnValue({
        pollingEnabled: true,
        pollingIntervalMinutes: 2,
      }),
      computeCallTrackingHash: jest.fn().mockImplementation((row: any) => {
        const norm = (val?: string | null) =>
          val ? String(val).trim().toLowerCase() : '';
        return [
          norm(row.applicationStatus),
          norm(row.currentInterviewRound),
          norm(row.call1Date),
          norm(row.call1Status),
          norm(row.call1Remarks),
          norm(row.call2Date),
          norm(row.call2Status),
          norm(row.call2Remarks),
          norm(row.call3Date),
          norm(row.call3Status),
          norm(row.call3Remarks),
          norm(row.nextFollowUpDate),
          norm(row.hrRemarks),
        ].join(':::');
      }),
      recordSyncedHash: jest
        .fn()
        .mockImplementation(async (candidateId: number, hash: string) => {
          redisStore.set(
            `recruitment:google-sheets:last-synced-hash:${candidateId}`,
            hash,
          );
        }),
      getSyncedHash: jest
        .fn()
        .mockImplementation(async (candidateId: number) => {
          return (
            redisStore.get(
              `recruitment:google-sheets:last-synced-hash:${candidateId}`,
            ) || null
          );
        }),
      readCandidateTrackerRows: jest.fn().mockResolvedValue([]),
      updateFollowUpEmailStatusInSheet: jest.fn().mockResolvedValue(true),
      saveCandidate: jest.fn().mockImplementation(async (input: any) => {
        return {
          action: 'updated',
          candidateId: input.id,
          rowNumber: 2,
          updatedRange: `'Candidate Tracker'!A2:Z2`,
        };
      }),
      sanitizeError: jest.fn((e: any) => String(e?.message || e)),
    };

    mockGmailService = {
      sendEmail: jest.fn().mockImplementation(async () => {
        return { messageId: 'gmail-msg-12345', status: 'SENT' };
      }),
      downloadAttachment: jest
        .fn()
        .mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
    };

    mockMailService = {
      sendDirect: jest.fn().mockResolvedValue({ messageId: 'smtp-msg-12345' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateService,
        { provide: CandidateExcelService, useValue: mockCandidateExcelService },
        { provide: GoogleSheetsService, useValue: mockGoogleSheetsService },
        { provide: GmailService, useValue: mockGmailService },
        { provide: MailService, useValue: mockMailService },
        { provide: RedisService, useValue: { client: mockRedisClient } },
        {
          provide: HrAssignmentService,
          useValue: new HrAssignmentService(mockHrConfig as any),
        },
        {
          provide: CandidateNotificationService,
          useValue: { notifyAssignedHr: jest.fn() },
        },
        { provide: ResumeFingerprintService, useValue: {} },
        { provide: hrConfigFactory.KEY, useValue: mockHrConfig },
        { provide: mailConfigFactory.KEY, useValue: mockMailConfig },
      ],
    }).compile();

    candidateService = module.get<CandidateService>(CandidateService);
  });

  describe('1. Call Outcome Classification and Counting Rules', () => {
    it('should classify "Not Answered" as qualifying unanswered and increment both total and qualifying count', async () => {
      const res = await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        notes: 'Rang completely, no answer',
        callerHrId: 'hr-1',
      });

      expect(res.success).toBe(true);
      expect(res.totalCallAttempts).toBe(1);
      expect(res.qualifyingUnansweredCount).toBe(1);
      expect(res.lastCallStatus).toBe('Not Answered');
      expect(res.call1DateAndStatus).toContain('Not Answered');
      expect(res.emailTriggered).toBe(false);
      expect(res.automatedFollowUpEmailStatus).toBe('NOT_SENT');
    });

    it('should classify "Busy" and "Switched Off" as qualifying unanswered attempts', async () => {
      const res1 = await candidateService.recordCallAttempt(101, {
        status: 'Busy',
        callerHrId: 'hr-1',
      });
      expect(res1.callAttempt.isQualifyingUnanswered).toBe(true);
      expect(res1.qualifyingUnansweredCount).toBe(1);

      const res2 = await candidateService.recordCallAttempt(101, {
        status: 'Switched Off',
        callerHrId: 'hr-1',
      });
      expect(res2.callAttempt.isQualifyingUnanswered).toBe(true);
      expect(res2.qualifyingUnansweredCount).toBe(2);
    });

    it('should NOT treat "Answered" as an unanswered call', async () => {
      const res = await candidateService.recordCallAttempt(101, {
        status: 'Answered',
        notes: 'Candidate discussed interest in role',
        callerHrId: 'hr-1',
      });

      expect(res.totalCallAttempts).toBe(1);
      expect(res.qualifyingUnansweredCount).toBe(0);
      expect(res.callAttempt.isQualifyingUnanswered).toBe(false);
      expect(res.lastCallStatus).toBe('Answered');
      expect(res.emailTriggered).toBe(false);
    });

    it('should NOT treat "Call Back Requested" as unanswered and should record nextFollowUpDate', async () => {
      const res = await candidateService.recordCallAttempt(101, {
        status: 'Call Back Requested',
        nextFollowUpDate: '2026-10-18 14:00 IST',
        notes: 'Candidate in exam, asked to call on Saturday',
        callerHrId: 'hr-1',
      });

      expect(res.totalCallAttempts).toBe(1);
      expect(res.qualifyingUnansweredCount).toBe(0);
      expect(res.callAttempt.isQualifyingUnanswered).toBe(false);
      expect(res.nextFollowUpDate).toBe('2026-10-18 14:00 IST');
      expect(res.emailTriggered).toBe(false);
    });

    it('should NOT treat "Invalid Number" as unanswered call and should record remarks', async () => {
      const res = await candidateService.recordCallAttempt(101, {
        status: 'Invalid Number',
        callerHrId: 'hr-1',
      });

      expect(res.totalCallAttempts).toBe(1);
      expect(res.qualifyingUnansweredCount).toBe(0);
      expect(res.callAttempt.isQualifyingUnanswered).toBe(false);
      expect(mockCandidateExcelService.saveCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          hrRemarks: expect.stringContaining(
            'Invalid Phone Number reported by HR',
          ),
        }),
      );
    });
  });

  describe('2. Three Qualifying Unanswered Attempts and Automated Follow-up Email', () => {
    it('should automatically send the professional follow-up email upon the 3rd qualifying unanswered call attempt', async () => {
      // Call 1: Not Answered
      const call1 = await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      expect(call1.qualifyingUnansweredCount).toBe(1);
      expect(call1.emailTriggered).toBe(false);
      expect(mockGmailService.sendEmail).not.toHaveBeenCalled();

      // Call 2: Busy
      const call2 = await candidateService.recordCallAttempt(101, {
        status: 'Busy',
        callerHrId: 'hr-1',
      });
      expect(call2.qualifyingUnansweredCount).toBe(2);
      expect(call2.emailTriggered).toBe(false);
      expect(mockGmailService.sendEmail).not.toHaveBeenCalled();

      // Call 3: Not Answered (Threshold reached)
      const call3 = await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });

      expect(call3.qualifyingUnansweredCount).toBe(3);
      expect(call3.totalCallAttempts).toBe(3);
      expect(call3.emailTriggered).toBe(true);
      expect(call3.automatedFollowUpEmailStatus).toBe('SENT');
      expect(call3.followUpEmailSentAt).toBeDefined();

      // Verify email was dispatched via Gmail service with candidate name and job role
      expect(mockGmailService.sendEmail).toHaveBeenCalledTimes(1);
      const emailArgs = mockGmailService.sendEmail.mock.calls[0][0];
      expect(emailArgs.to).toBe('rahul.verma@example.com');
      expect(emailArgs.subject).toContain('React Developer');
      expect(emailArgs.bodyText).toContain('Dear Rahul Verma,');
      expect(emailArgs.bodyText).toContain(
        'Greetings from Codes for Tomorrow!',
      );
      expect(emailArgs.bodyText).toContain(
        'regarding your application for the React Developer position',
      );
      expect(emailArgs.bodyText).toContain(
        'reply to this email with a convenient time for us to connect',
      );
      expect(emailArgs.bodyText).toContain('Best regards,');
      expect(emailArgs.bodyText).toContain('HR Team');
      expect(emailArgs.bodyText).toContain('Codes for Tomorrow');

      // Verify Google Sheets & Excel synchronization

      expect(mockGoogleSheetsService.saveCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 101,
          callCount: 3,
          automatedFollowUpEmailStatus: 'SENT',
          call1DateAndStatus: expect.stringContaining('Not Answered'),
          call2DateAndStatus: expect.stringContaining('Busy'),
          call3DateAndStatus: expect.stringContaining('Not Answered'),
        }),
      );
    });

    it('should NOT trigger follow-up email if an attempt was Answered and qualifying count < 3', async () => {
      // Call 1: Not Answered (Qualifying: 1)
      await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      // Call 2: Answered (Qualifying: 1, Total: 2)
      await candidateService.recordCallAttempt(101, {
        status: 'Answered',
        callerHrId: 'hr-1',
      });
      // Call 3: Not Answered (Qualifying: 2, Total: 3)
      const call3 = await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });

      expect(call3.totalCallAttempts).toBe(3);
      expect(call3.qualifyingUnansweredCount).toBe(2);
      expect(call3.emailTriggered).toBe(false);
      expect(mockGmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should NOT trigger follow-up email if earlier attempt was Call Back Requested or Invalid Number', async () => {
      // Call 1: Call Back Requested (Non-qualifying)
      await candidateService.recordCallAttempt(101, {
        status: 'Call Back Requested',
        callerHrId: 'hr-1',
      });
      // Call 2: Busy (Qualifying: 1)
      await candidateService.recordCallAttempt(101, {
        status: 'Busy',
        callerHrId: 'hr-1',
      });
      // Call 3: Switched Off (Qualifying: 2, Total: 3)
      const call3 = await candidateService.recordCallAttempt(101, {
        status: 'Switched Off',
        callerHrId: 'hr-1',
      });

      expect(call3.totalCallAttempts).toBe(3);
      expect(call3.qualifyingUnansweredCount).toBe(2);
      expect(call3.emailTriggered).toBe(false);
      expect(mockGmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should trigger follow-up email when attempts are Not Answered, Busy, and Switched Off (all 3 qualifying)', async () => {
      // Call 1: Not Answered
      await candidateService.recordCallAttempt(102, {
        status: 'Not Answered',
        callerHrId: 'hr-2',
      });
      // Call 2: Busy
      await candidateService.recordCallAttempt(102, {
        status: 'Busy',
        callerHrId: 'hr-2',
      });
      // Call 3: Switched Off
      const call3 = await candidateService.recordCallAttempt(102, {
        status: 'Switched Off',
        callerHrId: 'hr-2',
      });

      expect(call3.totalCallAttempts).toBe(3);
      expect(call3.qualifyingUnansweredCount).toBe(3);
      expect(call3.emailTriggered).toBe(true);
      expect(call3.automatedFollowUpEmailStatus).toBe('SENT');
      expect(mockGmailService.sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Candidate Replies and Exit Workflow Verification', () => {
    it('should skip follow-up email if candidate has replied before the 3rd attempt', async () => {
      await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });

      // Candidate replies
      await candidateService.markCandidateReplied(101);

      // Attempt 3
      const call3 = await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });

      expect(call3.qualifyingUnansweredCount).toBe(3);
      expect(call3.emailTriggered).toBe(false);
      expect(call3.automatedFollowUpEmailStatus).toBe('SKIPPED_REPLIED');
      expect(mockGmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should skip follow-up email if candidate has exited workflow (e.g. Rejected or Hired)', async () => {
      const candidate = candidateDb.get(101)!;
      candidate.applicationStatus = 'Rejected';

      await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      const call3 = await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });

      expect(call3.emailTriggered).toBe(false);
      expect(mockGmailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('4. Duplicate Triggers and Idempotency Safety', () => {
    it('should NOT send duplicate email on subsequent calls (attempt 4, 5) if email was already sent', async () => {
      // 3 qualifying calls trigger email
      await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      const call3 = await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      expect(call3.emailTriggered).toBe(true);
      expect(mockGmailService.sendEmail).toHaveBeenCalledTimes(1);

      // 4th call attempt
      const call4 = await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      expect(call4.totalCallAttempts).toBe(4);
      expect(call4.qualifyingUnansweredCount).toBe(4);
      expect(call4.emailTriggered).toBe(false);
      expect(mockGmailService.sendEmail).toHaveBeenCalledTimes(1); // Still 1, no duplicate
    });

    it('should handle concurrent processing with distributed lock and prevent duplicate sends', async () => {
      // Setup candidate with 2 calls
      await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });

      // Simulate lock already acquired by another thread/job
      redisStore.set('lock:call-followup-email:101', 'existing-lock-token');

      // Attempt 3 while lock is held
      const call3 = await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      expect(call3.emailTriggered).toBe(false);
      expect(call3.emailResult?.reason).toContain('locked');
      expect(mockGmailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('5. Invalid Candidate Email Handling', () => {
    it('should set status to FAILED_INVALID_EMAIL and not crash when candidate email is invalid', async () => {
      // Candidate 103 has email 'invalid-email-format'
      await candidateService.recordCallAttempt(103, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      await candidateService.recordCallAttempt(103, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });
      const call3 = await candidateService.recordCallAttempt(103, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
      });

      expect(call3.qualifyingUnansweredCount).toBe(3);
      expect(call3.emailTriggered).toBe(false);
      expect(call3.automatedFollowUpEmailStatus).toBe('FAILED_INVALID_EMAIL');
      expect(mockGmailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('6. Role-Based HR Assignment and Authorization', () => {
    it('should allow HR1 to record calls for candidates assigned to HR1', async () => {
      const res = await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        callerHrId: 'hr-1',
        callerHrEmail: 'aasthanegi.mongoosetech@gmail.com',
      });
      expect(res.success).toBe(true);
      expect(res.callAttempt.assignedHrId).toBe('hr-1');
    });

    it('should allow HR2 to record calls for candidates assigned to HR2', async () => {
      const res = await candidateService.recordCallAttempt(102, {
        status: 'Not Answered',
        callerHrId: 'hr-2',
        callerHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
      });
      expect(res.success).toBe(true);
      expect(res.callAttempt.assignedHrId).toBe('hr-2');
    });

    it('should REJECT HR1 attempting to record a call for a candidate assigned to HR2', async () => {
      await expect(
        candidateService.recordCallAttempt(102, {
          status: 'Not Answered',
          callerHrId: 'hr-1',
          callerHrEmail: 'aasthanegi.mongoosetech@gmail.com',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should REJECT HR2 attempting to record a call for a candidate assigned to HR1', async () => {
      await expect(
        candidateService.recordCallAttempt(101, {
          status: 'Not Answered',
          callerHrId: 'hr-2',
          callerHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('7. Persistent Call History and Retrieval Endpoint', () => {
    it('should retrieve full call history and attempt metrics for a candidate', async () => {
      await candidateService.recordCallAttempt(101, {
        status: 'Not Answered',
        notes: 'First attempt ring-out',
        callerHrId: 'hr-1',
      });
      await candidateService.recordCallAttempt(101, {
        status: 'Call Back Requested',
        nextFollowUpDate: '2026-10-17 10:00 IST',
        callerHrId: 'hr-1',
      });

      const history = await candidateService.getCallAttempts(101);

      expect(history.candidateId).toBe(101);
      expect(history.totalCallAttempts).toBe(2);
      expect(history.qualifyingUnansweredCount).toBe(1);
      expect(history.lastCallStatus).toBe('Call Back Requested');
      expect(history.nextFollowUpDate).toBe('2026-10-17 10:00 IST');
      expect(history.attempts.length).toBe(2);
      expect(history.attempts[0].notes).toBe('First attempt ring-out');
      expect(history.attempts[1].status).toBe('Call Back Requested');
    });
  });

  describe('8. Separate HR Call-Attempt Columns & Google Sheets Schema', () => {
    it('should record 1st, 2nd, and 3rd call attempts into separate dedicated fields without overwriting previous history', async () => {
      // Record 1st call attempt
      const res1 = await candidateService.recordCallAttempt(101, {
        attemptNumber: 1,
        status: 'Not Answered',
        notes: 'No response after 5 rings',
        callDate: '2026-10-16 10:30 IST',
        callerHrId: 'hr-1',
      });

      expect(res1.call1Status).toBe('Not Answered');
      expect(res1.call1Remarks).toBe('No response after 5 rings');
      expect(res1.call1Date).toBe('2026-10-16 10:30 IST');
      expect(res1.totalCallAttempts).toBe(1);

      // Record 2nd call attempt independently
      const res2 = await candidateService.recordCallAttempt(101, {
        attemptNumber: 2,
        status: 'Busy',
        notes: 'Line was engaged',
        callDate: '2026-10-16 14:00 IST',
        callerHrId: 'hr-1',
      });

      // Assert 1st call preserved and 2nd call populated
      expect(res2.call1Status).toBe('Not Answered');
      expect(res2.call1Remarks).toBe('No response after 5 rings');
      expect(res2.call2Status).toBe('Busy');
      expect(res2.call2Remarks).toBe('Line was engaged');
      expect(res2.call2Date).toBe('2026-10-16 14:00 IST');
      expect(res2.totalCallAttempts).toBe(2);

      // Record 3rd call attempt independently
      const res3 = await candidateService.recordCallAttempt(101, {
        attemptNumber: 3,
        status: 'Answered',
        notes: 'Candidate answered and scheduled screening',
        callDate: '2026-10-16 17:00 IST',
        callerHrId: 'hr-1',
      });

      expect(res3.call1Status).toBe('Not Answered');
      expect(res3.call2Status).toBe('Busy');
      expect(res3.call3Status).toBe('Answered');
      expect(res3.call3Remarks).toBe(
        'Candidate answered and scheduled screening',
      );
      expect(res3.call3Date).toBe('2026-10-16 17:00 IST');
      expect(res3.totalCallAttempts).toBe(3);
      // Because attempt 3 was answered, follow-up email should not trigger
      expect(res3.emailTriggered).toBe(false);

      // Verify Google Sheets save received all individual attempt fields
      expect(mockGoogleSheetsService.saveCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 101,
          totalCallAttempts: 3,
          call1Status: 'Not Answered',
          call1Remarks: 'No response after 5 rings',
          call2Status: 'Busy',
          call2Remarks: 'Line was engaged',
          call3Status: 'Answered',
          call3Remarks: 'Candidate answered and scheduled screening',
        }),
      );
    });

    it('should verify GoogleSheetsService EXPECTED_HEADERS contains all 12 required columns', () => {
      const requiredColumns = [
        '1st Call Date',
        '1st Call Status',
        '1st Call Remarks',
        '2nd Call Date',
        '2nd Call Status',
        '2nd Call Remarks',
        '3rd Call Date',
        '3rd Call Status',
        '3rd Call Remarks',
        'Total Call Attempts',
        'Automated Follow-up Email Status',
        'Follow-up Email Sent At',
      ];

      for (const col of requiredColumns) {
        expect(GoogleSheetsService.EXPECTED_HEADERS).toContain(col);
      }
      expect(GoogleSheetsService.EXPECTED_HEADERS).not.toContain(
        'Last Contact Date',
      );
    });

    it('should verify GoogleSheetsService CALL_STATUS_OPTIONS includes all required statuses', () => {
      const requiredStatuses = [
        'Not Answered',
        'Answered',
        'Busy',
        'Call Back Requested',
        'Invalid Number',
      ];

      for (const status of requiredStatuses) {
        expect(GoogleSheetsService.CALL_STATUS_OPTIONS).toContain(status);
      }
    });

    it('should migrate 17-column layout to 26-column layout, safely mapping legacy call data only when justified', async () => {
      const service = new GoogleSheetsService(
        {
          spreadsheetId: 'test-spreadsheet-id',
          keyFile: './test-key.json',
          tabName: 'Candidate Tracker',
        } as any,
        { client: null } as any,
      );

      const legacy17Headers = [
        'Candidate ID',
        'Candidate Name',
        'Email Address',
        'Mobile Number',
        'Job Role Applied For',
        'Assigned HR Name',
        'Total Experience (Years)',
        'Current Company',
        'Application Status',
        'Current Interview Round',
        'Total Call Attempts',
        'Last Call Status',
        'Last Contact Date',
        'Next Follow-up Date',
        'HR Remarks',
        'Last Updated By',
        'Last Updated At',
      ];

      // Row 2: Candidate with "Not Called" (unjustified call mapping)
      const rowAastha = [
        '1',
        'Aastha Negi',
        'aasthan927@gmail.com',
        '9027437223',
        'QA Engineer',
        'Jayendra',
        '2',
        '47Billion, Indore',
        'Shortlisted',
        'Not Started',
        '0',
        'Not Called',
        '',
        '',
        'Detailed HR review remarks for Aastha',
        'AI Recruitment System',
        '2026-10-16',
      ];

      // Row 3: Candidate with actual prior call outcome (justified call mapping)
      const rowAbhishek = [
        '2',
        'Abhishek Goud',
        'abhigoud198484@gmail.com',
        '9074304063',
        'Backend Developer',
        'Manual Review',
        '3',
        'Salford & Co Corporation',
        'New',
        'Not Started',
        '1',
        'Not Answered',
        '15/10/2026 14:30:00',
        '17/10/2026 11:00:00',
        'Detailed HR review remarks for Abhishek',
        'AI Recruitment System',
        '2026-10-16',
      ];

      const initialRows = [legacy17Headers, rowAastha, rowAbhishek];

      const batchUpdateRequests: any[] = [];

      const mockSheetsClient: any = {
        spreadsheets: {
          values: {
            update: jest.fn().mockImplementation(() => {
              return Promise.resolve({
                data: { updatedRange: "'Candidate Tracker'!A1:Z3" },
              });
            }),
          },
          batchUpdate: jest.fn().mockImplementation(({ requestBody }) => {
            batchUpdateRequests.push(...requestBody.requests);
            return Promise.resolve({ data: {} });
          }),
        },
      };

      const result = await service.migrateSheetSchemaIfOutdated(
        mockSheetsClient,
        'test-spreadsheet-id',
        0,
        'Candidate Tracker',
        initialRows,
      );

      // Verify header row is now 26 canonical columns
      expect(result.length).toBe(3);
      expect(result[0]).toEqual(GoogleSheetsService.EXPECTED_HEADERS);
      expect(result[0].length).toBe(26);

      // Verify Row 2 (Aastha): "Not Called" was NOT mapped into 1st Call Status or 1st Call Date
      const migratedAastha = result[1];
      expect(migratedAastha[0]).toBe('1'); // Candidate ID
      expect(migratedAastha[1]).toBe('Aastha Negi');
      expect(migratedAastha[2]).toBe('aasthan927@gmail.com');
      expect(migratedAastha[8]).toBe('Shortlisted');
      expect(migratedAastha[9]).toBe('Not Started');
      expect(migratedAastha[10]).toBe(0); // Total Call Attempts remains 0
      expect(migratedAastha[11]).toBe(''); // 1st Call Date empty
      expect(migratedAastha[12]).toBe(''); // 1st Call Status empty (Not Called ignored)
      expect(migratedAastha[13]).toBe(''); // 1st Call Remarks
      expect(migratedAastha[20]).toBe(''); // Next Follow-up Date
      expect(migratedAastha[23]).toBe('Detailed HR review remarks for Aastha'); // HR Remarks preserved
      expect(migratedAastha[24]).toBe('AI Recruitment System'); // Last Updated By preserved
      expect(migratedAastha[25]).toBe('2026-10-16'); // Last Updated At preserved

      // Verify Row 3 (Abhishek): Actual prior outcome was preserved into 1st Call attempt
      const migratedAbhishek = result[2];
      expect(migratedAbhishek[0]).toBe('2');
      expect(migratedAbhishek[1]).toBe('Abhishek Goud');
      expect(migratedAbhishek[10]).toBe(1); // Total Call Attempts is 1
      expect(migratedAbhishek[11]).toBe('15/10/2026 14:30:00'); // 1st Call Date populated
      expect(migratedAbhishek[12]).toBe('Not Answered'); // 1st Call Status populated
      expect(migratedAbhishek[20]).toBe('17/10/2026 11:00:00'); // Next Follow-up Date preserved
      expect(migratedAbhishek[23]).toBe(
        'Detailed HR review remarks for Abhishek',
      ); // HR Remarks preserved

      // Verify sheets update was dispatched
      expect(mockSheetsClient.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'Candidate Tracker'!A1:Z3",
          valueInputOption: 'RAW',
        }),
      );

      // Verify repeated migration on up-to-date schema is idempotent and makes no update calls
      mockSheetsClient.spreadsheets.values.update.mockClear();
      const secondRun = await service.migrateSheetSchemaIfOutdated(
        mockSheetsClient,
        'test-spreadsheet-id',
        0,
        'Candidate Tracker',
        result,
      );

      expect(secondRun).toBe(result);
      expect(
        mockSheetsClient.spreadsheets.values.update,
      ).not.toHaveBeenCalled();
    });

    it('should test ensureCandidateTrackerSheet executes onModuleInit startup migration', async () => {
      const service = new GoogleSheetsService(
        {
          spreadsheetId: 'test-spreadsheet-id',
          keyFile: './test-key.json',
          tabName: 'Candidate Tracker',
        } as any,
        { client: null } as any,
      );

      jest.spyOn(service, 'isConfigured').mockReturnValue(true);

      const legacyRows = [
        [
          'Candidate ID',
          'Candidate Name',
          'Email Address',
          'Last Contact Date',
          'HR Remarks',
        ],
        [
          '1',
          'Test Candidate',
          'test@example.com',
          '16/10/2026',
          'Some remarks',
        ],
      ];

      const mockSheetsClient: any = {
        spreadsheets: {
          get: jest.fn().mockResolvedValue({
            data: {
              sheets: [
                {
                  properties: {
                    sheetId: 0,
                    title: 'Candidate Tracker',
                    gridProperties: { rowCount: 1000, columnCount: 26 },
                  },
                },
              ],
            },
          }),
          values: {
            get: jest.fn().mockResolvedValue({
              data: { values: legacyRows },
            }),
            update: jest.fn().mockResolvedValue({ data: {} }),
          },
          batchUpdate: jest.fn().mockResolvedValue({ data: {} }),
        },
      };

      service.setMockSheetsClient(mockSheetsClient);

      const migrationStatus = await service.ensureCandidateTrackerSheet();

      expect(migrationStatus.status).toBe('migrated');
      expect(migrationStatus.tabName).toBe('Candidate Tracker');
      expect(migrationStatus.newHeaderCount).toBe(26);
      expect(mockSheetsClient.spreadsheets.values.update).toHaveBeenCalled();
    });

    it('should configure Google Sheets with date format on L, O, R without dropdowns, and dropdown validation strictly on M, P, S', async () => {
      const service = new GoogleSheetsService(
        {
          spreadsheetId: 'test-spreadsheet-id',
          keyFile: './test-key.json',
          tabName: 'Candidate Tracker',
        } as any,
        { client: null } as any,
      );

      let batchRequests: any[] = [];
      const mockSheetsClient: any = {
        spreadsheets: {
          batchUpdate: jest.fn().mockImplementation(async (params: any) => {
            batchRequests = params.requestBody?.requests || [];
            return { data: {} };
          }),
        },
      };

      await service.ensureSheetColumnValidationsAndFormatting(
        mockSheetsClient,
        'test-spreadsheet-id',
        0,
        1000,
      );

      expect(mockSheetsClient.spreadsheets.batchUpdate).toHaveBeenCalled();

      // Check request 1: clear all data validation across the grid
      const clearValidationReq = batchRequests.find(
        (r) => r.setDataValidation && !r.setDataValidation.rule,
      );
      expect(clearValidationReq).toBeDefined();
      expect(clearValidationReq.setDataValidation.range.startColumnIndex).toBe(
        0,
      );
      expect(clearValidationReq.setDataValidation.range.endColumnIndex).toBe(
        26,
      );

      // Check date format applied to L (11), O (14), R (17)
      const dateFormats = batchRequests.filter(
        (r) =>
          r.repeatCell?.cell?.userEnteredFormat?.numberFormat?.type ===
          'DATE_TIME',
      );
      const dateColIndices = dateFormats.map(
        (d) => d.repeatCell.range.startColumnIndex,
      );
      expect(dateColIndices).toContain(11); // L: 1st Call Date
      expect(dateColIndices).toContain(14); // O: 2nd Call Date
      expect(dateColIndices).toContain(17); // R: 3rd Call Date

      // Ensure NO validation rule set on date columns L (11), O (14), R (17)
      const validationsWithRules = batchRequests.filter(
        (r) => r.setDataValidation?.rule !== undefined,
      );
      const validatedCols = validationsWithRules.map(
        (v) => v.setDataValidation.range.startColumnIndex,
      );
      expect(validatedCols).not.toContain(11); // L must NOT have validation
      expect(validatedCols).not.toContain(14); // O must NOT have validation
      expect(validatedCols).not.toContain(17); // R must NOT have validation

      // Ensure NO validation rule set on remarks columns N (13), Q (16), T (19)
      expect(validatedCols).not.toContain(13); // N must NOT have validation
      expect(validatedCols).not.toContain(16); // Q must NOT have validation
      expect(validatedCols).not.toContain(19); // T must NOT have validation

      // Ensure dropdown validation present on M (12), P (15), S (18)
      expect(validatedCols).toContain(12); // M: 1st Call Status
      expect(validatedCols).toContain(15); // P: 2nd Call Status
      expect(validatedCols).toContain(18); // S: 3rd Call Status

      // Check that the dropdown options on M (12) match GoogleSheetsService.CALL_STATUS_OPTIONS
      const mValidation = validationsWithRules.find(
        (v) => v.setDataValidation.range.startColumnIndex === 12,
      );
      const mValues = mValidation.setDataValidation.rule.condition.values.map(
        (val: any) => val.userEnteredValue,
      );
      expect(mValues).toEqual(GoogleSheetsService.CALL_STATUS_OPTIONS);
      expect(mValues).toEqual([
        'Not Answered',
        'Answered',
        'Busy',
        'Call Back Requested',
        'Invalid Number',
        'Switched Off',
      ]);
    });
  });

  describe('Google Sheets → Backend Polling for HR Call Tracking', () => {
    it('should detect a new call status entered directly in Google Sheets and reconcile history', async () => {
      // HR enters Call 1 directly in Google Sheets for Rahul Verma (ID: 101)
      mockGoogleSheetsService.readCandidateTrackerRows.mockResolvedValueOnce([
        {
          rowIndex: 2,
          candidateId: 101,
          candidateName: 'Rahul Verma',
          email: 'rahul.verma@example.com',
          phone: '9876543210',
          jobRole: 'React Developer',
          assignedHrName: 'Aastha',
          totalExperience: '3',
          currentCompany: 'TCS',
          applicationStatus: 'Shortlisted',
          currentInterviewRound: 'Not Started',
          totalCallAttempts: 1,
          call1Date: '2026-10-16 10:00:00',
          call1Status: 'Not Answered',
          call1Remarks: 'Ringing no response',
          call2Date: '',
          call2Status: '',
          call2Remarks: '',
          call3Date: '',
          call3Status: '',
          call3Remarks: '',
          nextFollowUpDate: '2026-10-17',
          automatedFollowUpEmailStatus: 'NOT_SENT',
          followUpEmailSentAt: '',
          hrRemarks: '',
          lastUpdatedBy: 'Aastha',
          lastUpdatedAt: '2026-10-16 10:05:00',
        },
      ]);

      const pollResult = await candidateService.pollGoogleSheetsForCallUpdates({
        triggerSource: 'SCHEDULED',
      });

      expect(pollResult.status).toBe('SUCCESS');
      expect(pollResult.changedCandidatesCount).toBe(1);
      expect(pollResult.details[0].action).toBe('RECONCILED');
      expect(pollResult.details[0].qualifyingUnansweredCount).toBe(1);

      // Verify Excel candidate record was updated
      const updatedCandidate = candidateDb.get(101);
      expect(updatedCandidate?.call1Status).toBe('Not Answered');
      expect(updatedCandidate?.call1Date).toBe('2026-10-16 10:00:00');
      expect(updatedCandidate?.call1Remarks).toBe('Ringing no response');

      // Verify Redis persisted history
      const redisCalls = JSON.parse(
        redisStore.get('recruitment:candidate:calls:101') || '[]',
      );
      expect(redisCalls.length).toBe(1);
      expect(redisCalls[0].status).toBe('Not Answered');
      expect(redisCalls[0].isQualifyingUnanswered).toBe(true);

      // Verify synced hash was cached in Redis
      const cachedHash = redisStore.get(
        'recruitment:google-sheets:last-synced-hash:101',
      );
      expect(cachedHash).toBeDefined();
    });

    it('should detect changed call date or remarks and update history without duplicating records', async () => {
      // First poll establishes Call 1
      mockGoogleSheetsService.readCandidateTrackerRows.mockResolvedValueOnce([
        {
          rowIndex: 2,
          candidateId: 101,
          candidateName: 'Rahul Verma',
          email: 'rahul.verma@example.com',
          phone: '9876543210',
          jobRole: 'React Developer',
          assignedHrName: 'Aastha',
          totalExperience: '3',
          currentCompany: 'TCS',
          applicationStatus: 'Shortlisted',
          currentInterviewRound: 'Not Started',
          totalCallAttempts: 1,
          call1Date: '2026-10-16 10:00:00',
          call1Status: 'Not Answered',
          call1Remarks: 'First note',
          call2Date: '',
          call2Status: '',
          call2Remarks: '',
          call3Date: '',
          call3Status: '',
          call3Remarks: '',
          nextFollowUpDate: '',
          automatedFollowUpEmailStatus: 'NOT_SENT',
          followUpEmailSentAt: '',
          hrRemarks: '',
          lastUpdatedBy: 'Aastha',
          lastUpdatedAt: '2026-10-16 10:05:00',
        },
      ]);
      await candidateService.pollGoogleSheetsForCallUpdates();

      // HR updates call date and remarks in Google Sheets
      mockGoogleSheetsService.readCandidateTrackerRows.mockResolvedValueOnce([
        {
          rowIndex: 2,
          candidateId: 101,
          candidateName: 'Rahul Verma',
          email: 'rahul.verma@example.com',
          phone: '9876543210',
          jobRole: 'React Developer',
          assignedHrName: 'Aastha',
          totalExperience: '3',
          currentCompany: 'TCS',
          applicationStatus: 'Shortlisted',
          currentInterviewRound: 'Not Started',
          totalCallAttempts: 1,
          call1Date: '2026-10-16 11:30:00',
          call1Status: 'Not Answered',
          call1Remarks: 'Updated remark: Candidate phone rang twice',
          call2Date: '',
          call2Status: '',
          call2Remarks: '',
          call3Date: '',
          call3Status: '',
          call3Remarks: '',
          nextFollowUpDate: '',
          automatedFollowUpEmailStatus: 'NOT_SENT',
          followUpEmailSentAt: '',
          hrRemarks: '',
          lastUpdatedBy: 'Aastha',
          lastUpdatedAt: '2026-10-16 11:35:00',
        },
      ]);

      const pollResult2 =
        await candidateService.pollGoogleSheetsForCallUpdates();
      expect(pollResult2.changedCandidatesCount).toBe(1);

      const redisCalls = JSON.parse(
        redisStore.get('recruitment:candidate:calls:101') || '[]',
      );
      expect(redisCalls.length).toBe(1); // Still 1 attempt, NOT duplicated
      expect(redisCalls[0].callDate).toBe('2026-10-16 11:30:00');
      expect(redisCalls[0].notes).toBe(
        'Updated remark: Candidate phone rang twice',
      );
    });

    it('should skip processing and create NO duplicate attempts on repeated identical polls', async () => {
      const sheetRow = {
        rowIndex: 2,
        candidateId: 101,
        candidateName: 'Rahul Verma',
        email: 'rahul.verma@example.com',
        phone: '9876543210',
        jobRole: 'React Developer',
        assignedHrName: 'Aastha',
        totalExperience: '3',
        currentCompany: 'TCS',
        applicationStatus: 'Shortlisted',
        currentInterviewRound: 'Not Started',
        totalCallAttempts: 1,
        call1Date: '2026-10-16 10:00:00',
        call1Status: 'Not Answered',
        call1Remarks: 'Ringing',
        call2Date: '',
        call2Status: '',
        call2Remarks: '',
        call3Date: '',
        call3Status: '',
        call3Remarks: '',
        nextFollowUpDate: '',
        automatedFollowUpEmailStatus: 'NOT_SENT',
        followUpEmailSentAt: '',
        hrRemarks: '',
        lastUpdatedBy: 'Aastha',
        lastUpdatedAt: '2026-10-16 10:05:00',
      };

      // Poll 1
      mockGoogleSheetsService.readCandidateTrackerRows.mockResolvedValueOnce([
        sheetRow,
      ]);
      const poll1 = await candidateService.pollGoogleSheetsForCallUpdates();
      expect(poll1.changedCandidatesCount).toBe(1);

      // Poll 2 with identical sheet values
      mockGoogleSheetsService.readCandidateTrackerRows.mockResolvedValueOnce([
        sheetRow,
      ]);
      const poll2 = await candidateService.pollGoogleSheetsForCallUpdates();
      expect(poll2.changedCandidatesCount).toBe(0);
      expect(poll2.details[0].action).toBe('UNCHANGED');

      // Verify attempts remain 1
      const redisCalls = JSON.parse(
        redisStore.get('recruitment:candidate:calls:101') || '[]',
      );
      expect(redisCalls.length).toBe(1);
    });

    it('should trigger exactly one follow-up email upon 3 qualifying unanswered calls entered in sheet', async () => {
      mockGoogleSheetsService.readCandidateTrackerRows.mockResolvedValueOnce([
        {
          rowIndex: 2,
          candidateId: 101,
          candidateName: 'Rahul Verma',
          email: 'rahul.verma@example.com',
          phone: '9876543210',
          jobRole: 'React Developer',
          assignedHrName: 'Aastha',
          totalExperience: '3',
          currentCompany: 'TCS',
          applicationStatus: 'Shortlisted',
          currentInterviewRound: 'Not Started',
          totalCallAttempts: 3,
          call1Date: '2026-10-14 10:00:00',
          call1Status: 'Not Answered',
          call1Remarks: 'First unanswered call',
          call2Date: '2026-10-15 14:00:00',
          call2Status: 'Busy',
          call2Remarks: 'Line busy',
          call3Date: '2026-10-16 16:00:00',
          call3Status: 'Switched Off',
          call3Remarks: 'Phone switched off',
          nextFollowUpDate: '',
          automatedFollowUpEmailStatus: 'NOT_SENT',
          followUpEmailSentAt: '',
          hrRemarks: '',
          lastUpdatedBy: 'Aastha',
          lastUpdatedAt: '2026-10-16 16:05:00',
        },
      ]);

      const poll1 = await candidateService.pollGoogleSheetsForCallUpdates();
      expect(poll1.changedCandidatesCount).toBe(1);
      expect(poll1.emailsTriggeredCount).toBe(1);
      expect(poll1.details[0].emailTriggered).toBe(true);

      // Email sent once via mailService
      expect(mockGmailService.sendEmail).toHaveBeenCalledTimes(1);
      // Status in sheet updated to SENT
      expect(
        mockGoogleSheetsService.updateFollowUpEmailStatusInSheet,
      ).toHaveBeenCalledWith(101, 'SENT', expect.any(String));

      // Second poll: should NOT send email again
      mockGoogleSheetsService.readCandidateTrackerRows.mockResolvedValueOnce([
        {
          rowIndex: 2,
          candidateId: 101,
          candidateName: 'Rahul Verma',
          email: 'rahul.verma@example.com',
          phone: '9876543210',
          jobRole: 'React Developer',
          assignedHrName: 'Aastha',
          totalExperience: '3',
          currentCompany: 'TCS',
          applicationStatus: 'Shortlisted',
          currentInterviewRound: 'Not Started',
          totalCallAttempts: 3,
          call1Date: '2026-10-14 10:00:00',
          call1Status: 'Not Answered',
          call1Remarks: 'First unanswered call',
          call2Date: '2026-10-15 14:00:00',
          call2Status: 'Busy',
          call2Remarks: 'Line busy',
          call3Date: '2026-10-16 16:00:00',
          call3Status: 'Switched Off',
          call3Remarks: 'Phone switched off',
          nextFollowUpDate: '',
          automatedFollowUpEmailStatus: 'SENT',
          followUpEmailSentAt: '2026-10-16T16:05:00.000Z',
          hrRemarks: '',
          lastUpdatedBy: 'Aastha',
          lastUpdatedAt: '2026-10-16 16:05:00',
        },
      ]);

      const poll2 = await candidateService.pollGoogleSheetsForCallUpdates({
        force: true,
      });
      expect(poll2.emailsTriggeredCount).toBe(0);
      expect(mockGmailService.sendEmail).toHaveBeenCalledTimes(1); // Still exactly 1
    });

    it('should NOT trigger follow-up email if non-qualifying statuses are entered', async () => {
      mockGoogleSheetsService.readCandidateTrackerRows.mockResolvedValueOnce([
        {
          rowIndex: 2,
          candidateId: 101,
          candidateName: 'Rahul Verma',
          email: 'rahul.verma@example.com',
          phone: '9876543210',
          jobRole: 'React Developer',
          assignedHrName: 'Aastha',
          totalExperience: '3',
          currentCompany: 'TCS',
          applicationStatus: 'Shortlisted',
          currentInterviewRound: 'Not Started',
          totalCallAttempts: 3,
          call1Date: '2026-10-14 10:00:00',
          call1Status: 'Not Answered', // Qualifying
          call1Remarks: '',
          call2Date: '2026-10-15 14:00:00',
          call2Status: 'Call Back Requested', // Non-qualifying!
          call2Remarks: '',
          call3Date: '2026-10-16 16:00:00',
          call3Status: 'Busy', // Qualifying
          call3Remarks: '',
          nextFollowUpDate: '',
          automatedFollowUpEmailStatus: 'NOT_SENT',
          followUpEmailSentAt: '',
          hrRemarks: '',
          lastUpdatedBy: 'Aastha',
          lastUpdatedAt: '2026-10-16 16:05:00',
        },
      ]);

      const poll = await candidateService.pollGoogleSheetsForCallUpdates();
      expect(poll.changedCandidatesCount).toBe(1);
      expect(poll.emailsTriggeredCount).toBe(0);
      expect(poll.details[0].emailTriggered).toBe(false);
      expect(poll.details[0].qualifyingUnansweredCount).toBe(2);
      expect(mockGmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should NOT trigger follow-up email if candidate has replied or exited workflow', async () => {
      // Mark candidate 101 as replied
      redisStore.set('candidate:replied:101', 'TRUE');

      mockGoogleSheetsService.readCandidateTrackerRows.mockResolvedValueOnce([
        {
          rowIndex: 2,
          candidateId: 101,
          candidateName: 'Rahul Verma',
          email: 'rahul.verma@example.com',
          phone: '9876543210',
          jobRole: 'React Developer',
          assignedHrName: 'Aastha',
          totalExperience: '3',
          currentCompany: 'TCS',
          applicationStatus: 'Shortlisted',
          currentInterviewRound: 'Not Started',
          totalCallAttempts: 3,
          call1Date: '2026-10-14 10:00:00',
          call1Status: 'Not Answered',
          call1Remarks: '',
          call2Date: '2026-10-15 14:00:00',
          call2Status: 'Busy',
          call2Remarks: '',
          call3Date: '2026-10-16 16:00:00',
          call3Status: 'Switched Off',
          call3Remarks: '',
          nextFollowUpDate: '',
          automatedFollowUpEmailStatus: 'NOT_SENT',
          followUpEmailSentAt: '',
          hrRemarks: '',
          lastUpdatedBy: 'Aastha',
          lastUpdatedAt: '2026-10-16 16:05:00',
        },
      ]);

      const poll = await candidateService.pollGoogleSheetsForCallUpdates();
      expect(poll.emailsTriggeredCount).toBe(0);
      expect(mockGmailService.sendEmail).not.toHaveBeenCalled();
      const updatedCandidate = candidateDb.get(101);
      expect(updatedCandidate?.automatedFollowUpEmailStatus).toBe(
        'SKIPPED_REPLIED',
      );
    });

    it('should prevent overlapping concurrent polling runs', async () => {
      // Simulate polling currently in progress
      (candidateService as any).isPollingGoogleSheets = true;

      const concurrentPoll =
        await candidateService.pollGoogleSheetsForCallUpdates();
      expect(concurrentPoll.status).toBe('SKIPPED');
      expect(concurrentPoll.message).toContain('already in progress');

      // Reset
      (candidateService as any).isPollingGoogleSheets = false;
    });

    it('should handle Google Sheets API failure gracefully and recover on next run', async () => {
      mockGoogleSheetsService.readCandidateTrackerRows.mockRejectedValueOnce(
        new Error('Google Sheets API 503 Backend Error: Service Unavailable'),
      );

      const failedPoll =
        await candidateService.pollGoogleSheetsForCallUpdates();
      expect(failedPoll.status).toBe('FAILED');
      expect(failedPoll.message).toContain('Google Sheets read failed');

      // In-memory lock is released
      expect((candidateService as any).isPollingGoogleSheets).toBe(false);

      // Next run succeeds
      mockGoogleSheetsService.readCandidateTrackerRows.mockResolvedValueOnce(
        [],
      );
      const recoveredPoll =
        await candidateService.pollGoogleSheetsForCallUpdates();
      expect(recoveredPoll.status).toBe('SUCCESS');
    });

    it('should preserve existing call history when sheet cells are blank and preserve HR-managed fields', async () => {
      // Candidate 101 already has Call 1 in Redis
      redisStore.set(
        'recruitment:candidate:calls:101',
        JSON.stringify([
          {
            attemptNumber: 1,
            callDate: '2026-10-15 10:00:00',
            formattedCallDate: '2026-10-15 10:00:00',
            status: 'Not Answered',
            notes: 'Existing Call 1 note',
            isQualifyingUnanswered: true,
          },
        ]),
      );

      // Sheet has empty strings for Call 1, but HR updated applicationStatus and HR remarks
      mockGoogleSheetsService.readCandidateTrackerRows.mockResolvedValueOnce([
        {
          rowIndex: 2,
          candidateId: 101,
          candidateName: 'Rahul Verma',
          email: 'rahul.verma@example.com',
          phone: '9876543210',
          jobRole: 'React Developer',
          assignedHrName: 'Aastha',
          totalExperience: '3',
          currentCompany: 'TCS',
          applicationStatus: 'On Hold',
          currentInterviewRound: 'Technical Round 1',
          totalCallAttempts: 1,
          call1Date: '',
          call1Status: '',
          call1Remarks: '',
          call2Date: '',
          call2Status: '',
          call2Remarks: '',
          call3Date: '',
          call3Status: '',
          call3Remarks: '',
          nextFollowUpDate: '2026-10-20',
          automatedFollowUpEmailStatus: 'NOT_SENT',
          followUpEmailSentAt: '',
          hrRemarks: 'Candidate requested interview postponement',
          lastUpdatedBy: 'Aastha',
          lastUpdatedAt: '2026-10-16 12:00:00',
        },
      ]);

      const poll = await candidateService.pollGoogleSheetsForCallUpdates();
      expect(poll.status).toBe('SUCCESS');
      expect(poll.changedCandidatesCount).toBe(1);

      // Verify existing Call 1 was preserved
      const redisCalls = JSON.parse(
        redisStore.get('recruitment:candidate:calls:101') || '[]',
      );
      expect(redisCalls.length).toBe(1);
      expect(redisCalls[0].status).toBe('Not Answered');
      expect(redisCalls[0].notes).toBe('Existing Call 1 note');

      // Verify HR-managed fields were updated in Excel
      const updatedCandidate = candidateDb.get(101);
      expect(updatedCandidate?.applicationStatus).toBe('On Hold');
      expect(updatedCandidate?.currentInterviewRound).toBe('Technical Round 1');
      expect(updatedCandidate?.hrRemarks).toBe(
        'Candidate requested interview postponement',
      );
      expect(updatedCandidate?.nextFollowUpDate).toBe('2026-10-20');
    });
  });
});
