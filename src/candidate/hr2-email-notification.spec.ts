import { Test, TestingModule } from '@nestjs/testing';
import { CandidateNotificationService } from './candidate-notification.service';
import { CandidateExcelService } from './candidate-excel.service';
import { GoogleSheetsService } from './google-sheets.service';
import { MailService } from '../mail/mail.service';
import { GmailService } from '../mail/gmail.service';
import { RedisService } from '../redis';
import { hrConfigFactory, appConfigFactory } from '@Config';
import { NotificationStatus } from '../generated/prisma/client';

describe('HR2 Email Notifications for Resume Screening', () => {
  let candidateNotificationService: CandidateNotificationService;
  let mailService: MailService;
  let redisStore: Map<string, string>;

  const mockHrConfig = {
    hr1: {
      id: 'hr-1',
      name: 'Abhishek',
      email: 'abhigoud198484@gmail.com',
    },
    hr2: {
      id: 'hr-2',
      name: 'Jayendra',
      email: 'jayendrabamne.mongoosetech@gmail.com',
    },
    manualReviewEmail: 'abhigoud198484@gmail.com',
    adminWebUrl: 'https://admin.codesfortomorrow.com',
    appWebUrl: 'https://app.codesfortomorrow.com',
  };

  const createTestModule = async (customHrConfig = mockHrConfig) => {
    redisStore = new Map();

    const mockRedisClient = {
      get: jest
        .fn()
        .mockImplementation(async (key: string) => redisStore.get(key) || null),
      set: jest.fn().mockImplementation(async (key: string, value: string) => {
        redisStore.set(key, String(value));
        return 'OK';
      }),
      del: jest
        .fn()
        .mockImplementation(async (key: string) =>
          redisStore.delete(key) ? 1 : 0,
        ),
      eval: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
      sismember: jest.fn().mockResolvedValue(0),
      sadd: jest.fn().mockResolvedValue(1),
    };

    const mockExcelService = {
      saveCandidate: jest.fn().mockImplementation(async (input: any) => ({
        id: input.id || 101,
        ...input,
      })),
      getCandidateById: jest.fn().mockImplementation(async (id: number) => ({
        id,
        name: 'Avani Shrivastava',
        email: 'avanishrivastava311@gmail.com',
        phone: '+91 7000310666',
        jobRole: 'HR Intern',
        assignedHrName: 'Jayendra',
        assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
        screeningStatus: 'SHORTLIST',
        applicationStatus: 'Shortlisted',
        matchScore: 94,
        notificationStatus: 'PENDING',
      })),
    };

    const mockSheetsService = {
      isConfigured: jest.fn().mockReturnValue(true),
      getSpreadsheetUrl: jest
        .fn()
        .mockReturnValue(
          'https://docs.google.com/spreadsheets/d/10EZZAoFAjrlBWajSnS20tv6okr_SnjzYY19cBgbpSUk/edit',
        ),
    };

    const mockMailService = {
      sendDirect: jest.fn().mockResolvedValue({
        messageId: 'msg-direct-101',
        response: '250 OK: Message accepted',
        rejected: [],
      }),
    };

    const mockGmailService = {
      downloadAttachment: jest
        .fn()
        .mockResolvedValue(Buffer.from('%PDF-1.4 test resume attachment')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateNotificationService,
        {
          provide: hrConfigFactory.KEY,
          useValue: customHrConfig,
        },
        {
          provide: appConfigFactory.KEY,
          useValue: { publicUrl: 'https://api.codesfortomorrow.com' },
        },
        {
          provide: CandidateExcelService,
          useValue: mockExcelService,
        },
        {
          provide: GoogleSheetsService,
          useValue: mockSheetsService,
        },
        {
          provide: MailService,
          useValue: mockMailService,
        },
        {
          provide: GmailService,
          useValue: mockGmailService,
        },
        {
          provide: RedisService,
          useValue: { client: mockRedisClient },
        },
      ],
    }).compile();

    return {
      notificationService: module.get<CandidateNotificationService>(
        CandidateNotificationService,
      ),
      excelService: module.get<CandidateExcelService>(CandidateExcelService),
      mailService: module.get<MailService>(MailService),
    };
  };

  beforeEach(async () => {
    const services = await createTestModule();
    candidateNotificationService = services.notificationService;
    mailService = services.mailService;
  });

  describe('1. HR1 notification flow', () => {
    it('should send email to HR1 for candidates assigned to HR1 (Abhishek)', async () => {
      const candidate = {
        id: 201,
        name: 'Technical Candidate',
        email: 'tech@example.com',
        phone: '+91 9876543210',
        jobRole: 'Senior React Developer',
        assignedHrName: 'Abhishek',
        assignedHrEmail: 'abhigoud198484@gmail.com',
        screeningStatus: 'SHORTLIST',
        matchScore: 88,
        summary: 'Strong frontend engineering background',
      };

      const recipients =
        candidateNotificationService.getHrRecipients(candidate);
      expect(recipients).toEqual(['abhigoud198484@gmail.com']);

      const result =
        await candidateNotificationService.notifyAssignedHr(candidate);

      expect(result.status).toBe(NotificationStatus.Sent);
      expect(result.recipient).toBe('abhigoud198484@gmail.com');
      expect(mailService.sendDirect).toHaveBeenCalledTimes(1);
      expect(mailService.sendDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'abhigoud198484@gmail.com',
          subject: expect.stringContaining(
            '[Shortlisted] Technical Candidate - Senior React Developer',
          ),
        }),
      );

      // Verify that recipient-specific idempotency key was written
      expect(
        redisStore.get('candidate:notified:201:abhigoud198484@gmail.com'),
      ).toBe('SENT');
    });

    it('should map HR1 by name even when assignedHrEmail is missing', async () => {
      const candidate = {
        id: 202,
        name: 'Fullstack Dev',
        jobRole: 'Node.js Developer',
        assignedHrName: 'Abhishek',
        screeningStatus: 'SHORTLIST',
        matchScore: 85,
      };

      const resolution =
        candidateNotificationService.resolveTargetHr(candidate);
      expect(resolution.targetRecipient).toBe('abhigoud198484@gmail.com');
      expect(resolution.hrName).toBe('Abhishek');

      const result =
        await candidateNotificationService.notifyAssignedHr(candidate);
      expect(result.status).toBe(NotificationStatus.Sent);
      expect(result.recipient).toBe('abhigoud198484@gmail.com');
    });
  });

  describe('2. HR2 (Jayendra) notification flow', () => {
    it('should send email to HR2 for candidates assigned to HR2 (Jayendra)', async () => {
      const candidate = {
        id: 203,
        name: 'Avani Shrivastava',
        email: 'avanishrivastava311@gmail.com',
        phone: '+91 7000310666',
        jobRole: 'HR Intern',
        assignedHrName: 'Jayendra',
        assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
        screeningStatus: 'SHORTLIST',
        matchScore: 94,
        summary: 'Excellent recruitment candidate with strong communication',
        experience: [{ company: 'Lernx' }],
        skills: ['Recruitment', 'Excel', 'Screening'],
      };

      const recipients =
        candidateNotificationService.getHrRecipients(candidate);
      expect(recipients).toEqual(['jayendrabamne.mongoosetech@gmail.com']);

      const result =
        await candidateNotificationService.notifyAssignedHr(candidate);

      expect(result.status).toBe(NotificationStatus.Sent);
      expect(result.recipient).toBe('jayendrabamne.mongoosetech@gmail.com');
      expect(mailService.sendDirect).toHaveBeenCalledTimes(1);
      expect(mailService.sendDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jayendrabamne.mongoosetech@gmail.com',
          subject: expect.stringContaining(
            '[Shortlisted] Avani Shrivastava - HR Intern (Score: 94/100)',
          ),
        }),
      );

      // Verify recipient-specific idempotency key
      expect(
        redisStore.get(
          'candidate:notified:203:jayendrabamne.mongoosetech@gmail.com',
        ),
      ).toBe('SENT');
    });

    it('should correctly resolve HR2 email from Jayendra assignedHrName when assignedHrEmail is omitted', async () => {
      const candidate = {
        id: 204,
        name: 'Reeti Jain',
        jobRole: 'HR Executive',
        assignedHrName: 'Jayendra', // from Google Sheets column F
        screeningStatus: 'SHORTLIST',
        matchScore: 90,
      };

      const resolution =
        candidateNotificationService.resolveTargetHr(candidate);
      expect(resolution.targetRecipient).toBe(
        'jayendrabamne.mongoosetech@gmail.com',
      );
      expect(resolution.hrName).toBe('Jayendra');

      const result =
        await candidateNotificationService.notifyAssignedHr(candidate);
      expect(result.status).toBe(NotificationStatus.Sent);
      expect(result.recipient).toBe('jayendrabamne.mongoosetech@gmail.com');
    });
  });

  describe('3. Cross-recipient idempotency: HR1 notification does not suppress HR2', () => {
    it('should allow notification to HR2 even if HR1 was previously notified for the same candidate ID', async () => {
      const candidateId = 205;
      // Simulate HR1 was previously notified (e.g. before reassignment or role update)
      redisStore.set(
        `candidate:notified:${candidateId}:abhigoud198484@gmail.com`,
        'SENT',
      );

      const candidateAssignedToHr2 = {
        id: candidateId,
        name: 'Reassigned Candidate',
        jobRole: 'HR Associate',
        assignedHrName: 'Jayendra',
        assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
        screeningStatus: 'SHORTLIST',
        matchScore: 92,
      };

      // notifyAssignedHr must check the recipient-specific key and proceed
      const result = await candidateNotificationService.notifyAssignedHr(
        candidateAssignedToHr2,
      );

      expect(result.status).toBe(NotificationStatus.Sent);
      expect(result.recipient).toBe('jayendrabamne.mongoosetech@gmail.com');
      expect(mailService.sendDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jayendrabamne.mongoosetech@gmail.com',
        }),
      );

      // Both keys should exist in redisStore
      expect(
        redisStore.get(
          `candidate:notified:${candidateId}:abhigoud198484@gmail.com`,
        ),
      ).toBe('SENT');
      expect(
        redisStore.get(
          `candidate:notified:${candidateId}:jayendrabamne.mongoosetech@gmail.com`,
        ),
      ).toBe('SENT');
    });
  });

  describe('4. Missing or invalid HR2 configuration', () => {
    it('should return a clear error when HR2 email is missing or empty', async () => {
      const { notificationService } = await createTestModule({
        ...mockHrConfig,
        hr2: {
          id: 'hr-2',
          name: 'Jayendra',
          email: '', // missing
        },
      });

      const candidate = {
        id: 206,
        name: 'Candidate Without HR2 Email',
        jobRole: 'HR Intern',
        assignedHrName: 'Jayendra',
        screeningStatus: 'SHORTLIST',
        matchScore: 95,
      };

      const resolution = notificationService.resolveTargetHr(candidate);
      expect(resolution.error).toContain(
        'Missing or invalid HR2 configuration',
      );

      const notifResult = await notificationService.notifyAssignedHr(candidate);
      expect(notifResult.status).toBe(NotificationStatus.Failed);
      expect(notifResult.error).toContain(
        'Missing or invalid HR2 configuration',
      );
    });

    it('should return a clear error when HR2 email format is invalid', async () => {
      const { notificationService } = await createTestModule({
        ...mockHrConfig,
        hr2: {
          id: 'hr-2',
          name: 'Jayendra',
          email: 'invalid-email-address',
        },
      });

      const candidate = {
        id: 207,
        name: 'Candidate With Bad HR2 Email',
        jobRole: 'HR Intern',
        assignedHrName: 'Jayendra',
        screeningStatus: 'SHORTLIST',
        matchScore: 95,
      };

      const resolution = notificationService.resolveTargetHr(candidate);
      expect(resolution.error).toContain(
        'Missing or invalid HR2 configuration',
      );

      const notifResult = await notificationService.notifyAssignedHr(candidate);
      expect(notifResult.status).toBe(NotificationStatus.Failed);
      expect(notifResult.error).toContain(
        'Missing or invalid HR2 configuration',
      );
    });
  });

  describe('5. Duplicate prevention and screening retries', () => {
    it('should skip duplicate notification if candidate was already notified to the same recipient', async () => {
      const candidateId = 208;
      redisStore.set(
        `candidate:notified:${candidateId}:jayendrabamne.mongoosetech@gmail.com`,
        'SENT',
      );

      const candidate = {
        id: candidateId,
        name: 'Avani Shrivastava',
        jobRole: 'HR Intern',
        assignedHrName: 'Jayendra',
        assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
        screeningStatus: 'SHORTLIST',
        matchScore: 94,
      };

      const result =
        await candidateNotificationService.notifyAssignedHr(candidate);

      expect(result.status).toBe(NotificationStatus.Sent);
      expect(mailService.sendDirect).not.toHaveBeenCalled();
    });

    it('should fail if email provider explicitly rejects the recipient', async () => {
      const { notificationService, mailService: mockMail } =
        await createTestModule();
      (mockMail.sendDirect as jest.Mock).mockResolvedValue({
        messageId: 'msg-rejected',
        response: '550 5.1.1 User unknown',
        rejected: ['jayendrabamne.mongoosetech@gmail.com'],
      });

      const candidate = {
        id: 209,
        name: 'Rejected Candidate',
        jobRole: 'HR Intern',
        assignedHrName: 'Jayendra',
        assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
        screeningStatus: 'SHORTLIST',
        matchScore: 94,
      };

      const result = await notificationService.notifyAssignedHr(candidate);
      expect(result.status).toBe(NotificationStatus.Failed);
      expect(result.error).toContain('Email provider rejected recipient');
      // Idempotency key must NOT be marked as SENT if provider rejected
      expect(
        redisStore.get(
          'candidate:notified:209:jayendrabamne.mongoosetech@gmail.com',
        ),
      ).toBeUndefined();
    });
  });

  describe('6. Google Sheets sync and duplicate prevention', () => {
    it('should safely skip notification when candidate notificationStatus is already SENT', async () => {
      const candidate = {
        id: 210,
        name: 'Sync Candidate',
        jobRole: 'HR Intern',
        assignedHrName: 'Jayendra',
        assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
        screeningStatus: 'SHORTLIST',
        notificationStatus: 'SENT',
        matchScore: 94,
      };

      // Simulate a sync invocation with an already notified candidate
      redisStore.set(
        `candidate:notified:210:jayendrabamne.mongoosetech@gmail.com`,
        'SENT',
      );

      const result =
        await candidateNotificationService.notifyAssignedHr(candidate);
      expect(result.status).toBe(NotificationStatus.Sent);
      expect(mailService.sendDirect).not.toHaveBeenCalled();
    });
  });

  describe('7. Manual Review notifications', () => {
    it('should dispatch manual review notification to configured manualReviewEmail with masked logs', async () => {
      const candidate = {
        id: 211,
        name: 'Borderline Candidate',
        jobRole: 'Unclear Role',
        assignedHrName: 'Manual Review',
        screeningStatus: 'MANUAL_REVIEW',
        matchScore: 45,
        summary: 'Requires human evaluation of portfolio',
        missingRequirements: ['Clear resume formatting', 'Portfolio link'],
      };

      const recipients =
        candidateNotificationService.getManualReviewRecipients();
      expect(recipients).toEqual(['abhigoud198484@gmail.com']);

      const result =
        await candidateNotificationService.notifyManualReview(candidate);

      expect(result.status).toBe(NotificationStatus.Sent);
      expect(result.recipient).toBe('abhigoud198484@gmail.com');
      expect(mailService.sendDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'abhigoud198484@gmail.com',
          subject: expect.stringContaining(
            '[Manual Review Required] Borderline Candidate - Unclear Role',
          ),
        }),
      );

      // Verify manual review idempotency key
      expect(
        redisStore.get(
          'candidate:notified:manual:211:abhigoud198484@gmail.com',
        ),
      ).toBe('SENT');
    });

    it('should prevent duplicate manual review notifications', async () => {
      const candidateId = 212;
      redisStore.set(
        `candidate:notified:manual:${candidateId}:abhigoud198484@gmail.com`,
        'SENT',
      );

      const candidate = {
        id: candidateId,
        name: 'Duplicate Flagged',
        assignedHrName: 'Manual Review',
        screeningStatus: 'MANUAL_REVIEW',
      };

      const result =
        await candidateNotificationService.notifyManualReview(candidate);
      expect(result.status).toBe(NotificationStatus.Sent);
      expect(mailService.sendDirect).not.toHaveBeenCalled();
    });
  });
});
