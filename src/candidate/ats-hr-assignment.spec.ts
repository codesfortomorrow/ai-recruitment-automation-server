import { Test, TestingModule } from '@nestjs/testing';
import { HrAssignmentService } from './hr-assignment.service';
import { CandidateService } from './candidate.service';
import { CandidateExcelService } from './candidate-excel.service';
import { CandidateNotificationService } from './candidate-notification.service';
import { GoogleSheetsService } from './google-sheets.service';
import { MailService } from '../mail/mail.service';
import { GmailService } from '../mail/gmail.service';
import { RedisService } from '../redis';
import { PrismaService } from '../prisma';
import { ResumeFingerprintService } from '../mail/resume-fingerprint.service';
import { hrConfigFactory, appConfigFactory } from '@Config';
import { NotificationStatus } from '../generated/prisma/client';

describe('ATS-Based HR Assignment and Recruitment Email Notifications', () => {
  let hrAssignmentService: HrAssignmentService;
  let candidateService: CandidateService;
  let candidateExcelService: CandidateExcelService;
  let candidateNotificationService: CandidateNotificationService;
  let googleSheetsService: GoogleSheetsService;
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

  beforeEach(async () => {
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
        call1Date: '2026-10-18',
        call1Status: 'Not Answered',
        call1Remarks: 'First call attempt',
        totalCallAttempts: 1,
        nextFollowUpDate: '2026-10-20',
      })),
      getAllCandidates: jest.fn().mockResolvedValue([
        {
          id: 1,
          name: 'Aastha Negi',
          email: 'aastha@example.com',
          phone: '+91 9876543210',
          jobRole: 'QA Engineer',
          assignedHrName: 'Jayendra',
          assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
          screeningStatus: 'SHORTLIST',
          applicationStatus: 'Shortlisted',
          matchScore: 95,
        },
        {
          id: 2,
          name: 'Abhishek Goud',
          email: 'abhishek@example.com',
          phone: '+91 9876543211',
          jobRole: 'Backend Developer',
          assignedHrName: 'Manual Review',
          assignedHrEmail: 'abhigoud198484@gmail.com',
          screeningStatus: 'MANUAL_REVIEW',
          applicationStatus: 'New',
          matchScore: 40,
        },
        {
          id: 3,
          name: 'Unknown',
          email: 'unknown@example.com',
          phone: '',
          jobRole: 'HR Intern',
          assignedHrName: 'Manual Review',
          assignedHrEmail: 'abhigoud198484@gmail.com',
          screeningStatus: 'MANUAL_REVIEW',
          applicationStatus: 'New',
          matchScore: 0,
        },
        {
          id: 4,
          name: 'Avani Shrivastava',
          email: 'avanishrivastava311@gmail.com',
          phone: '+91 7000310666',
          jobRole: 'HR Intern',
          assignedHrName: 'Manual Review',
          assignedHrEmail: 'abhigoud198484@gmail.com',
          screeningStatus: 'SHORTLIST',
          applicationStatus: 'Shortlisted',
          matchScore: 94,
          call1Date: '2026-10-19',
          call1Status: 'Not Answered',
          totalCallAttempts: 1,
        },
        {
          id: 5,
          name: 'Reeti Jain',
          email: 'reetijain25@gmail.com',
          phone: '+91 9752665399',
          jobRole: 'HR Intern',
          assignedHrName: 'Manual Review',
          assignedHrEmail: 'abhigoud198484@gmail.com',
          screeningStatus: 'SHORTLIST',
          applicationStatus: 'Shortlisted',
          matchScore: 90,
        },
        {
          id: 6,
          name: 'Aieshwarya Singh',
          email: 'singaieshwarya@gmail.com',
          phone: '9752293933',
          jobRole: 'HR Associate / HR Executive',
          assignedHrName: 'Manual Review',
          assignedHrEmail: 'abhigoud198484@gmail.com',
          screeningStatus: 'SHORTLIST',
          applicationStatus: 'Shortlisted',
          matchScore: 99,
        },
      ]),
    };

    const mockSheetsService = {
      isConfigured: jest.fn().mockReturnValue(true),
      saveCandidate: jest.fn().mockResolvedValue({
        action: 'UPDATED',
        rowNumber: 5,
        updatedRange: "'Candidate Tracker'!A5:Z5",
      }),
      sanitizeError: jest
        .fn()
        .mockImplementation((e) => String(e?.message || e)),
    };

    const mockMailService = {
      sendDirect: jest.fn().mockResolvedValue({ messageId: 'msg-notif-1' }),
    };

    const mockGmailService = {
      downloadAttachment: jest
        .fn()
        .mockResolvedValue(Buffer.from('%PDF-1.4 test resume')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrAssignmentService,
        CandidateService,
        CandidateNotificationService,
        {
          provide: hrConfigFactory.KEY,
          useValue: mockHrConfig,
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
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: ResumeFingerprintService,
          useValue: {
            isFingerprintProcessed: jest.fn().mockResolvedValue(false),
            markFingerprintProcessed: jest.fn().mockResolvedValue(true),
            releaseProcessingLock: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    hrAssignmentService = module.get<HrAssignmentService>(HrAssignmentService);
    candidateService = module.get<CandidateService>(CandidateService);
    candidateExcelService = module.get<CandidateExcelService>(
      CandidateExcelService,
    );
    candidateNotificationService = module.get<CandidateNotificationService>(
      CandidateNotificationService,
    );
    googleSheetsService = module.get<GoogleSheetsService>(GoogleSheetsService);
    mailService = module.get<MailService>(MailService);
  });

  describe('1. Eligible recruitment candidate with ATS score 60 or above -> HR2/Jayendra', () => {
    it('should assign HR Intern candidate scoring >= 60 with SHORTLIST status to Jayendra (HR2)', () => {
      const assignment = hrAssignmentService.assignHr('HR Intern', {
        matchScore: 94,
        screeningStatus: 'SHORTLIST',
      });

      expect(assignment).not.toBeNull();
      expect(assignment!.name).toBe('Jayendra');
      expect(assignment!.id).toBe('hr-2');
      expect(assignment!.email).toBe('jayendrabamne.mongoosetech@gmail.com');
      expect(assignment!.canonicalRole).toBe('HR_INTERN');
    });

    it('should assign HR Executive candidate scoring exactly 60 with SHORTLIST status to Jayendra (HR2)', () => {
      const assignment = hrAssignmentService.assignHr(
        'HR Associate / HR Executive',
        {
          matchScore: 60,
          screeningStatus: 'SHORTLIST',
        },
      );

      expect(assignment).not.toBeNull();
      expect(assignment!.name).toBe('Jayendra');
      expect(assignment!.id).toBe('hr-2');
      expect(assignment!.email).toBe('jayendrabamne.mongoosetech@gmail.com');
      expect(assignment!.canonicalRole).toBe('HR_EXECUTIVE');
    });

    it('should recognize various recruitment role titles (recruiter, talent acquisition) scoring >= 60', () => {
      const titles = [
        'Talent Acquisition Specialist',
        'HR Executive',
        'Recruitment Executive',
        'Human Resources Associate',
        'Recruiter',
      ];

      for (const title of titles) {
        const assignment = hrAssignmentService.assignHr(title, {
          matchScore: 85,
          screeningStatus: 'SHORTLIST',
        });
        expect(assignment).not.toBeNull();
        expect(assignment!.name).toBe('Jayendra');
        expect(assignment!.email).toBe('jayendrabamne.mongoosetech@gmail.com');
      }
    });
  });

  describe('2. Eligible recruitment candidate with ATS score below 60 -> existing review rules apply (Manual Review)', () => {
    it('should assign recruitment candidate with ATS score 55 to Manual Review', () => {
      const assignment = hrAssignmentService.assignHr('HR Intern', {
        matchScore: 55,
        screeningStatus: 'MANUAL_REVIEW',
      });

      expect(assignment).not.toBeNull();
      expect(assignment!.name).toBe('Manual Review');
      expect(assignment!.id).toBe('hr-manual-review');
      expect(assignment!.email).toBe('abhigoud198484@gmail.com');
      expect(assignment!.canonicalRole).toBe('HR_INTERN');
    });

    it('should assign recruitment candidate with ATS score 40 to Manual Review', () => {
      const assignment = hrAssignmentService.assignHr('HR Executive', {
        matchScore: 40,
        screeningStatus: 'MANUAL_REVIEW',
      });

      expect(assignment).not.toBeNull();
      expect(assignment!.name).toBe('Manual Review');
      expect(assignment!.id).toBe('hr-manual-review');
      expect(assignment!.email).toBe('abhigoud198484@gmail.com');
      expect(assignment!.canonicalRole).toBe('HR_EXECUTIVE');
    });
  });

  describe('3. Candidate requiring genuine manual review -> Manual Review', () => {
    it('should assign candidate with unreadable resume / score 0 to Manual Review', () => {
      const assignment = hrAssignmentService.assignHr('HR Intern', {
        matchScore: 0,
        screeningStatus: 'MANUAL_REVIEW',
        missingRequirements: [
          'Unreadable resume format',
          'Missing experience details',
        ],
      });

      expect(assignment).not.toBeNull();
      expect(assignment!.name).toBe('Manual Review');
      expect(assignment!.id).toBe('hr-manual-review');
    });

    it('should assign candidate with hrReviewRequired flag to Manual Review even if score is high', () => {
      const assignment = hrAssignmentService.assignHr('HR Intern', {
        matchScore: 75,
        screeningStatus: 'MANUAL_REVIEW',
        hrReviewRequired: true,
      });

      expect(assignment).not.toBeNull();
      expect(assignment!.name).toBe('Manual Review');
      expect(assignment!.id).toBe('hr-manual-review');
    });
  });

  describe('4. A good ATS score for a non-recruitment role does not incorrectly trigger HR2 assignment', () => {
    it('should assign React Developer with ATS score 95 to HR1 (Abhishek), NOT HR2 (Jayendra)', () => {
      const assignment = hrAssignmentService.assignHr('React.js Developer', {
        matchScore: 95,
        screeningStatus: 'SHORTLIST',
      });

      expect(assignment).not.toBeNull();
      expect(assignment!.name).toBe('Abhishek');
      expect(assignment!.id).toBe('hr-1');
      expect(assignment!.email).toBe('abhigoud198484@gmail.com');
      expect(assignment!.canonicalRole).toBe('REACT_DEVELOPER');
    });

    it('should assign Software Engineer with ATS score 98 to HR1 (Abhishek)', () => {
      const assignment = hrAssignmentService.assignHr(
        'Full Stack Software Engineer',
        {
          matchScore: 98,
          screeningStatus: 'SHORTLIST',
        },
      );

      expect(assignment).not.toBeNull();
      expect(assignment!.name).toBe('Abhishek');
      expect(assignment!.id).toBe('hr-1');
      expect(assignment!.email).toBe('abhigoud198484@gmail.com');
    });

    it('should assign QA Engineer with ATS score 92 to HR2 (Jayendra) under QA category', () => {
      const assignment = hrAssignmentService.assignHr('QA Engineer', {
        matchScore: 92,
        screeningStatus: 'SHORTLIST',
      });

      expect(assignment).not.toBeNull();
      expect(assignment!.name).toBe('Jayendra');
      expect(assignment!.id).toBe('hr-2');
      expect(assignment!.canonicalRole).toBe('QA_TESTER');
    });
  });

  describe('5. The assigned HR name is consistent in database, Excel, and Google Sheets', () => {
    it('should persist Jayendra consistently across candidate record, Excel input, and Google Sheets row', async () => {
      const messageDetail: any = {
        id: 'msg-recruitment-101',
        sender: {
          name: 'Avani Shrivastava',
          email: 'avanishrivastava311@gmail.com',
        },
        subject: 'Application for HR Intern',
        attachments: [
          {
            attachmentId: 'att-101',
            filename: 'Avani_Resume.pdf',
            mimeType: 'application/pdf',
            size: 1024,
          },
        ],
      };

      const analysisResult: any = {
        status: 'success',
        attachmentId: 'att-101',
        filename: 'Avani_Resume.pdf',
        analysis: {
          candidate: {
            name: 'Avani Shrivastava',
            email: 'avanishrivastava311@gmail.com',
            phone: '+91 7000310666',
          },
          application: {
            jobRole: 'HR Intern',
            skills: ['Sourcing', 'Screening', 'Excel'],
            experience: ['Lernx Talent Acquisition'],
          },
          matchScore: 94,
          screeningStatus: 'SHORTLIST',
          recommendedStatus: 'Shortlist',
          summary: 'Qualified HR candidate',
          suggestedProfile: 'HR Intern',
        },
      };

      const record = await candidateService.persistAndProcessScreeningResult({
        messageDetail,
        analysisResult,
      });

      expect(record).not.toBeNull();
      expect(record.assignedHrName).toBe('Jayendra');
      expect(record.assignedHrEmail).toBe(
        'jayendrabamne.mongoosetech@gmail.com',
      );
      expect(record.assignedHrId).toBe('hr-2');

      // Verify Excel persistence call
      expect(candidateExcelService.saveCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          assignedHrName: 'Jayendra',
          assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
          screeningStatus: 'SHORTLIST',
        }),
      );

      // Verify Google Sheets persistence call
      expect(googleSheetsService.saveCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          assignedHrName: 'Jayendra',
          screeningStatus: 'SHORTLIST',
        }),
      );
    });
  });

  describe('6. HR2 receives the configured notification email after successful assignment', () => {
    it('should resolve and send shortlist notification strictly to Jayendra for HR recruitment role', async () => {
      const candidate = {
        id: 104,
        name: 'Avani Shrivastava',
        email: 'avanishrivastava311@gmail.com',
        phone: '+91 7000310666',
        jobRole: 'HR Intern',
        assignedHrName: 'Jayendra',
        assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
        screeningStatus: 'SHORTLIST',
        matchScore: 94,
        summary: 'Excellent recruitment candidate',
        experience: [{ company: 'Lernx' }],
        skills: ['Recruitment', 'Excel'],
      };

      const recipients =
        candidateNotificationService.getHrRecipients(candidate);
      expect(recipients).toEqual(['jayendrabamne.mongoosetech@gmail.com']);

      const notifResult =
        await candidateNotificationService.notifyAssignedHr(candidate);
      expect(notifResult.status).toBe(NotificationStatus.Sent);
      expect(mailService.sendDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jayendrabamne.mongoosetech@gmail.com',
          subject: expect.stringContaining(
            '[Shortlisted] Avani Shrivastava - HR Intern',
          ),
        }),
      );
    });
  });

  describe('7. Screening retries and sync cycles do not send duplicate emails', () => {
    it('should skip duplicate notification if candidate is already marked as notified in Redis', async () => {
      redisStore.set(
        'candidate:notified:104:jayendrabamne.mongoosetech@gmail.com',
        'SENT',
      );

      const candidate = {
        id: 104,
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
      // Ensure mail was NOT sent again
      expect(mailService.sendDirect).not.toHaveBeenCalled();
    });
  });

  describe('8. Existing HR call-tracking fields remain unchanged', () => {
    it('should safely reconcile misassigned candidates 4, 5, 6 while preserving candidate 2 and 3 manual review', async () => {
      const reconcileResult =
        await candidateService.reconcileMisassignedRecruitmentCandidates();

      expect(reconcileResult.scanned).toBe(6);
      expect(reconcileResult.reconciled).toBe(3); // Candidates 4, 5, 6
      expect(reconcileResult.skipped).toBe(3); // Candidates 1 (QA), 2 (Backend Dev 40), 3 (Unknown 0)

      const reconciledIds = reconcileResult.details.map((d) => d.id);
      expect(reconciledIds).toEqual([4, 5, 6]);

      // Verify that call-tracking fields on Candidate 4 were preserved during update
      expect(candidateExcelService.saveCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 4,
          assignedHrName: 'Jayendra',
          assignedHrEmail: 'jayendrabamne.mongoosetech@gmail.com',
          call1Date: '2026-10-19',
          call1Status: 'Not Answered',
          totalCallAttempts: 1,
        }),
      );
    });
  });
});
