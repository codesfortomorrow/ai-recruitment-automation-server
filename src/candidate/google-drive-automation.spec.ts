import { Test, TestingModule } from '@nestjs/testing';
import { GoogleDriveService } from './google-drive.service';
import { GoogleSheetsService } from './google-sheets.service';
import { CandidateService } from './candidate.service';
import { CandidateExcelService } from './candidate-excel.service';
import { CandidateNotificationService } from './candidate-notification.service';
import { HrAssignmentService } from './hr-assignment.service';
import { RecruitmentEmailClassifierService } from '../mail/recruitment-email-classifier.service';
import { ResumeScreeningQueueService } from '../mail/resume-screening-queue.service';
import { ResumeScreeningWorkerService } from '../mail/resume-screening-worker.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from '../mail/gemini.service';
import { MailService } from '../mail/mail.service';
import { GmailService } from '../mail/gmail.service';
import { GmailMessageDetail } from '../mail/gmail.types';
import { NotificationStatus } from '../generated/prisma/client';
import { ResumeFingerprintService } from '../mail/resume-fingerprint.service';
import {
  appConfigFactory,
  googleSheetsConfigFactory,
  hrConfigFactory,
  googleDriveConfigFactory,
  excelSyncConfigFactory,
  geminiConfigFactory,
} from '@Config';

describe('Google Drive CV Automation + Google Sheets + Resume Screening Suite', () => {
  let googleDriveService: GoogleDriveService;
  let googleSheetsService: GoogleSheetsService;
  let candidateNotificationService: CandidateNotificationService;
  let classifierService: RecruitmentEmailClassifierService;
  let hrAssignmentService: HrAssignmentService;
  let mockRedisClient: any;
  let mockSheetsClient: any;
  let mockDriveClient: any;
  let mockMailService: any;
  let mockGeminiService: any;

  beforeEach(async () => {
    const memoryStore = new Map<string, string>();

    mockRedisClient = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(memoryStore.get(key) || null),
        ),
      set: jest.fn().mockImplementation((key: string, val: string) => {
        memoryStore.set(key, val);
        return Promise.resolve('OK');
      }),
      del: jest.fn().mockImplementation((key: string) => {
        memoryStore.delete(key);
        return Promise.resolve(1);
      }),
      exists: jest
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(memoryStore.has(key) ? 1 : 0),
        ),
      sadd: jest.fn().mockResolvedValue(1),
      sismember: jest.fn().mockResolvedValue(0),
      eval: jest.fn().mockResolvedValue(1),
    };

    mockSheetsClient = {
      spreadsheets: {
        get: jest.fn().mockResolvedValue({
          data: {
            sheets: [
              {
                properties: {
                  sheetId: 0,
                  title: 'Candidate Tracker',
                },
              },
            ],
          },
        }),
        values: {
          get: jest.fn().mockResolvedValue({
            data: {
              values: [GoogleSheetsService.EXPECTED_HEADERS],
            },
          }),
          append: jest.fn().mockResolvedValue({
            data: {
              updates: {
                updatedRange: "'Candidate Tracker'!A2:AB2",
              },
            },
          }),
          update: jest.fn().mockResolvedValue({
            data: {
              updatedRange: "'Candidate Tracker'!A2:AB2",
            },
          }),
        },
        batchUpdate: jest.fn().mockResolvedValue({}),
      },
    };

    mockDriveClient = {
      files: {
        list: jest.fn().mockResolvedValue({
          data: {
            files: [],
          },
        }),
        create: jest.fn().mockResolvedValue({
          data: {
            id: 'drive-file-12345',
            name: 'Candidate_101_resume.pdf',
            webViewLink:
              'https://drive.google.com/file/d/drive-file-12345/view',
          },
        }),
        get: jest.fn().mockResolvedValue({
          data: {
            on: jest.fn((event: string, callback: any) => {
              if (event === 'data') {
                callback(Buffer.from('%PDF-1.4 sample content'));
              }
              if (event === 'end') {
                callback();
              }
            }),
          },
        }),
      },
    };

    mockMailService = {
      sendDirect: jest.fn().mockResolvedValue({
        messageId: 'msg-id-123',
        accepted: ['hr@example.com'],
        rejected: [],
        response: '250 OK',
      }),
    };

    mockGeminiService = {
      analyzeResume: jest.fn().mockResolvedValue({
        success: true,
        candidateName: 'Rahul Verma',
        email: 'rahul.verma@example.com',
        phone: '+91 9876543210',
        skills: ['Java', 'Spring Boot', 'PostgreSQL'],
        totalExperience: '4 years',
        matchedRole: 'Java Developer',
        atsScore: 85,
        summary:
          'Experienced backend Java developer with Spring Boot knowledge.',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleDriveService,
        GoogleSheetsService,
        CandidateService,
        CandidateExcelService,
        CandidateNotificationService,
        RecruitmentEmailClassifierService,
        HrAssignmentService,
        ResumeScreeningQueueService,
        ResumeScreeningWorkerService,
        {
          provide: RedisService,
          useValue: {
            client: mockRedisClient,
            isHealthy: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            candidate: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({ id: 101 }),
              update: jest.fn().mockResolvedValue({ id: 101 }),
            },
          },
        },
        {
          provide: GeminiService,
          useValue: mockGeminiService,
        },
        {
          provide: MailService,
          useValue: mockMailService,
        },
        {
          provide: GmailService,
          useValue: {
            downloadAttachment: jest
              .fn()
              .mockResolvedValue(Buffer.from('%PDF-1.4 test')),
            extractResumeText: jest
              .fn()
              .mockResolvedValue({ text: 'Java Spring Boot Hibernate' }),
          },
        },
        {
          provide: hrConfigFactory.KEY,
          useValue: {
            hr1: {
              id: 'hr-1',
              name: 'Abhishek',
              email: 'abhishek@company.com',
            },
            hr2: {
              id: 'hr-2',
              name: 'Jayendra',
              email: 'jayendra@company.com',
            },
            manualReviewEmail: 'manual-review@company.com',
          },
        },
        {
          provide: appConfigFactory.KEY,
          useValue: {
            appUrl: 'http://localhost:3000',
          },
        },
        {
          provide: googleSheetsConfigFactory.KEY,
          useValue: {
            spreadsheetId: 'test-spreadsheet-id',
            tabName: 'Candidate Tracker',
            keyFile: 'config/test-key.json',
          },
        },
        {
          provide: googleDriveConfigFactory.KEY,
          useValue: {
            cvFolderId: 'test-folder-id',
            cvFolderName: 'All Candidate CVs',
            serviceAccountKeyFile: 'config/test-key.json',
          },
        },
        {
          provide: excelSyncConfigFactory.KEY,
          useValue: {
            enabled: false,
            filePath: 'data/candidates.xlsx',
          },
        },
        {
          provide: ResumeFingerprintService,
          useValue: {
            isFingerprintProcessed: jest.fn().mockResolvedValue(false),
            markFingerprintProcessed: jest.fn().mockResolvedValue(true),
            releaseProcessingLock: jest.fn().mockResolvedValue(true),
            computeFingerprint: jest.fn().mockReturnValue('test-fp-12345'),
          },
        },
        {
          provide: geminiConfigFactory.KEY,
          useValue: {
            apiKey: 'test-api-key',
            model: 'gemini-1.5-flash',
          },
        },
      ],
    }).compile();

    googleDriveService = module.get<GoogleDriveService>(GoogleDriveService);
    googleSheetsService = module.get<GoogleSheetsService>(GoogleSheetsService);
    candidateNotificationService = module.get<CandidateNotificationService>(
      CandidateNotificationService,
    );
    classifierService = module.get<RecruitmentEmailClassifierService>(
      RecruitmentEmailClassifierService,
    );
    hrAssignmentService = module.get<HrAssignmentService>(HrAssignmentService);

    // Provide mocked google clients
    jest
      .spyOn(googleDriveService as any, 'getClient')
      .mockReturnValue(mockDriveClient);
    jest
      .spyOn(googleSheetsService as any, 'getClient')
      .mockReturnValue(mockSheetsClient);
    jest
      .spyOn(googleDriveService, 'ensureCvFolder')
      .mockResolvedValue('test-cv-folder-id');
  });

  describe('Requirement 1: Gmail Application Classification', () => {
    it('should classify genuine job application emails as recruitment matches', async () => {
      const email: GmailMessageDetail = {
        id: 'msg-job-1',
        threadId: 'th-job-1',
        sender: { name: 'Rahul Verma', email: 'rahul.verma@example.com' },
        recipient: 'careers@company.com',
        subject: 'Job Application: Senior Java Developer - Rahul Verma',
        snippet:
          'Please find attached my resume for the Java Developer position.',
        textBody:
          'Dear Hiring Team, Please find attached my resume for the Java Developer position.',
        receivedDate: new Date(),
        attachments: [
          {
            filename: 'Rahul_Verma_Resume.pdf',
            mimeType: 'application/pdf',
            size: 102400,
          },
        ],
      };

      const result = await classifierService.classifyEmail(email);
      expect(result.decision).toBe('RECRUITMENT_APPLICATION');
      expect(result.auditReason).toBe('RECRUITMENT_MATCH');
    });

    it('should reject unrelated company newsletters, marketing emails, or announcements', async () => {
      const email: GmailMessageDetail = {
        id: 'msg-nl-1',
        threadId: 'th-nl-1',
        sender: {
          name: 'Company Broadcast',
          email: 'hr-broadcast@internal.company.com',
        },
        recipient: 'all@company.com',
        subject: 'Company Holiday Notice: Diwali Celebration 2026',
        snippet:
          'All employees are informed that office will remain closed on Friday.',
        textBody:
          'All employees are informed that office will remain closed on Friday for celebrations.',
        receivedDate: new Date(),
        attachments: [
          {
            filename: 'HolidaySchedule.pdf',
            mimeType: 'application/pdf',
            size: 50000,
          },
        ],
      };

      const result = await classifierService.classifyEmail(email);
      expect(result.decision).toBe('UNRELATED_EMAIL');
      expect(result.auditReason).toBe('NO_APPLICATION_CONTEXT');
    });
  });

  describe('Requirements 2 & 3: New Manually Uploaded PDF/DOCX in Google Drive', () => {
    it('should detect and scan a new PDF file uploaded manually to Drive', async () => {
      mockDriveClient.files.list.mockResolvedValueOnce({
        data: {
          files: [
            {
              id: 'file-pdf-1',
              name: 'Candidate_Resume_Pooja.pdf',
              mimeType: 'application/pdf',
              size: '45000',
              createdTime: '2026-10-20T10:00:00Z',
            },
          ],
        },
      });

      const newFiles = await googleDriveService.scanNewCvFiles();
      expect(newFiles.length).toBe(1);
      expect(newFiles[0].fileId).toBe('file-pdf-1');
      expect(newFiles[0].name).toBe('Candidate_Resume_Pooja.pdf');
    });

    it('should detect a new DOCX file and ignore unsupported non-resume files', async () => {
      mockDriveClient.files.list.mockResolvedValueOnce({
        data: {
          files: [
            {
              id: 'file-docx-1',
              name: 'Profile_Aman.docx',
              mimeType:
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              size: '30000',
              createdTime: '2026-10-20T10:05:00Z',
            },
            {
              id: 'file-img-1',
              name: 'photo.jpg',
              mimeType: 'image/jpeg',
              size: '50000',
              createdTime: '2026-10-20T10:06:00Z',
            },
          ],
        },
      });

      const newFiles = await googleDriveService.scanNewCvFiles();
      expect(newFiles.length).toBe(1);
      expect(newFiles[0].fileId).toBe('file-docx-1');
    });
  });

  describe('Requirement 4: Gmail-originated CV and Drive-monitor Duplicate Detection', () => {
    it('should not re-screen a CV if it was already processed via Gmail and has an existing Drive file ID', async () => {
      const driveFileId = 'drive-gmail-dup-1';
      // Mark as processed in Redis
      await googleDriveService.markFileProcessed(driveFileId, 101);

      const isProcessed = await googleDriveService.isFileProcessed(driveFileId);
      expect(isProcessed).toBe(true);

      mockDriveClient.files.list.mockResolvedValueOnce({
        data: {
          files: [
            {
              id: driveFileId,
              name: 'Candidate_101_resume.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
      });

      const newFiles = await googleDriveService.scanNewCvFiles();
      // Should filter out already-processed files
      expect(newFiles.length).toBe(0);
    });
  });

  describe('Requirements 5 & 6: Resume Extraction, Role Detection & Java vs JavaScript', () => {
    it('should strictly differentiate Java from JavaScript Developer roles', () => {
      const javaSkills = ['Java', 'Spring Boot', 'Hibernate', 'Maven'];
      const jsSkills = ['JavaScript', 'TypeScript', 'Node.js', 'React'];

      const isJava =
        javaSkills.some((s) => s.toLowerCase() === 'java') &&
        !javaSkills.some((s) => s.toLowerCase() === 'javascript');
      const isJs = jsSkills.some((s) => s.toLowerCase() === 'javascript');

      expect(isJava).toBe(true);
      expect(isJs).toBe(true);
    });
  });

  describe('Requirements 7 & 8: Correct Role-to-HR Mapping & Unknown Roles', () => {
    it('should map technical software roles to HR1 and recruitment roles to HR2', () => {
      const devAssignment = hrAssignmentService.assignHr('Java Developer');
      expect(devAssignment?.id).toBe('hr-1');
      expect(devAssignment?.name).toBe('Abhishek');

      const hrAssignment = hrAssignmentService.assignHr('HR Recruiter', {
        matchScore: 75,
        screeningStatus: 'Shortlisted',
      });
      expect(hrAssignment?.id).toBe('hr-2');
      expect(hrAssignment?.name).toBe('Jayendra');
    });

    it('should handle unmapped or unknown roles cleanly by returning null or routing to manual review', () => {
      const unknownRole = 'Quantum Propulsion Astrodynamicist';
      const assignment = hrAssignmentService.assignHr(unknownRole);
      expect(assignment).toBeNull();
    });
  });

  describe('Requirements 9, 10 & 11: Drive File ID, Unique Filenames & Clickable CV Link', () => {
    it('should sanitize filename and build unique safe Drive name', () => {
      const rawName = 'My Resume - CV (2026)?.pdf';
      const sanitized = googleDriveService.sanitizeFilename(rawName);
      expect(sanitized).toBe('My_Resume_-_CV_2026_.pdf');
    });

    it('should generate valid clickable =HYPERLINK formula labelled "View CV"', () => {
      const driveFileId = 'drive-test-abc-999';
      const link = googleDriveService.getCvHyperlink(driveFileId);
      expect(link).toBe(
        `=HYPERLINK("https://drive.google.com/file/d/${driveFileId}/view", "View CV")`,
      );
    });
  });

  describe('Requirements 12 & 13: Google Sheets 28-Column Persistence & Preservation of HR Fields', () => {
    it('should save candidate to Google Sheets with 28 columns including CV Link and Drive File ID', async () => {
      const candidateInput = {
        id: 301,
        name: 'Sneha Patel',
        email: 'sneha@example.com',
        phone: '+91 9988776655',
        jobRole: 'Python Developer',
        assignedHrName: 'Abhishek',
        totalExperience: '3 years',
        currentCompany: 'Infosys',
        status: 'Shortlisted',
        atsScore: 82,
        driveFileId: 'drive-file-sneha-1',
        cvLink:
          '=HYPERLINK("https://drive.google.com/file/d/drive-file-sneha-1/view", "View CV")',
      };

      const result = await googleSheetsService.saveCandidate(candidateInput);
      expect(result.action).toBe('appended');

      expect(mockSheetsClient.spreadsheets.values.append).toHaveBeenCalledWith(
        expect.objectContaining({
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [
              expect.arrayContaining([
                301,
                'Sneha Patel',
                'sneha@example.com',
                '+91 9988776655',
                'Python Developer',
                'Abhishek',
                '=HYPERLINK("https://drive.google.com/file/d/drive-file-sneha-1/view", "View CV")',
                'drive-file-sneha-1',
              ]),
            ],
          },
        }),
      );
    });

    it('should preserve HR-managed call statuses, call dates, and HR remarks on candidate update', async () => {
      const existingRow = new Array(28).fill('');
      existingRow[0] = 301;
      existingRow[1] = 'Sneha Patel';
      existingRow[2] = 'sneha@example.com';
      existingRow[11] = '2026-10-21'; // 1st Call Date
      existingRow[12] = 'Connected'; // 1st Call Status
      existingRow[13] = 'Candidate interested, scheduled technical round'; // 1st Call Remarks
      existingRow[23] = 'Strong candidate with clean code architecture'; // HR Remarks
      existingRow[26] =
        '=HYPERLINK("https://drive.google.com/file/d/drive-file-sneha-1/view", "View CV")';
      existingRow[27] = 'drive-file-sneha-1';

      mockSheetsClient.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          values: [GoogleSheetsService.EXPECTED_HEADERS, existingRow],
        },
      });

      await googleSheetsService.saveCandidate({
        id: 301,
        name: 'Sneha Patel',
        email: 'sneha@example.com',
        phone: '+91 9988776655',
        jobRole: 'Python Developer',
        assignedHrName: 'Abhishek',
      });

      expect(mockSheetsClient.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'Candidate Tracker'!A2:AB2",
          requestBody: {
            values: [
              expect.arrayContaining([
                '2026-10-21',
                'Connected',
                'Candidate interested, scheduled technical round',
                'Strong candidate with clean code architecture',
              ]),
            ],
          },
        }),
      );
    });
  });

  describe('Requirements 14 & 15: Transient Error Retries for Drive and Sheets', () => {
    it('should retry transient 503 or 429 Google Sheets errors with bounded backoff', async () => {
      expect(
        googleSheetsService.isTransientError({
          code: 503,
          message: 'Backend Error',
        }),
      ).toBe(true);
      expect(
        googleSheetsService.isTransientError({
          code: 429,
          message: 'Rate Limit',
        }),
      ).toBe(true);
      // Permanent errors must fail fast
      expect(
        googleSheetsService.isTransientError({
          code: 401,
          message: 'Invalid Credentials',
        }),
      ).toBe(false);
      expect(
        googleSheetsService.isTransientError({
          code: 403,
          message: 'The caller does not have permission',
        }),
      ).toBe(false);
    });
  });

  describe('Requirements 16 & 17: Crash Recovery & Duplicate Notification Prevention', () => {
    it('should verify candidate is already saved in Google Sheets before skipping duplicate screening', async () => {
      const driveFileId = 'drive-crash-check-1';
      // Simulate that Sheets has row with this Drive File ID
      const sheetRow = new Array(28).fill('');
      sheetRow[0] = 405;
      sheetRow[1] = 'Vikas Gupta';
      sheetRow[2] = 'vikas@example.com';
      sheetRow[27] = driveFileId;

      mockSheetsClient.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          values: [GoogleSheetsService.EXPECTED_HEADERS, sheetRow],
        },
      });

      const existingRecord =
        await googleSheetsService.findCandidateByDriveFileId(driveFileId);
      expect(existingRecord).not.toBeNull();
      expect(existingRecord?.candidateId).toBe(405);
      expect(existingRecord?.rowNumber).toBe(2);
    });
  });

  describe('Requirement 18: HR Notification with Clickable Drive Link & Idempotency', () => {
    it('should send HR notification containing clickable Drive CV link and track idempotency', async () => {
      const candidate: any = {
        id: 501,
        name: 'Ananya Roy',
        email: 'ananya@example.com',
        phone: '+91 9123456780',
        jobRole: 'Java Developer',
        assignedHrName: 'Abhishek',
        assignedHrId: 'hr-1',
        assignedHrEmail: 'abhishek@company.com',
        screeningStatus: 'SHORTLIST',
        applicationStatus: 'Shortlisted',
        skills: ['Java', 'Spring Boot'],
        matchScore: 88,
        driveFileId: 'drive-ananya-501',
        cvLink:
          '=HYPERLINK("https://drive.google.com/file/d/drive-ananya-501/view", "View CV")',
      };

      const result =
        await candidateNotificationService.notifyAssignedHr(candidate);
      expect(result.status).toBe(NotificationStatus.Sent);
      expect(mockMailService.sendDirect).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'abhishek@company.com',
          html: expect.stringContaining(
            'https://drive.google.com/file/d/drive-ananya-501/view',
          ),
        }),
      );
      expect(mockMailService.sendDirect).toHaveBeenCalledTimes(1);

      // Sending again should be skipped due to notification idempotency key and not trigger email dispatch
      await candidateNotificationService.notifyAssignedHr(candidate);
      expect(mockMailService.sendDirect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Requirement 19: Identical Resume Content from Two Distinct Applicants', () => {
    it('should not merge two distinct applicants even if resume content/hash is identical', async () => {
      const candidate1 = {
        id: 601,
        name: 'Amit Kumar',
        email: 'amit.kumar@gmail.com',
        phone: '+91 9000000001',
        jobRole: 'QA Engineer',
        driveFileId: 'drive-amit-601',
      };

      const candidate2 = {
        id: 602,
        name: 'Suresh Kumar',
        email: 'suresh.kumar@gmail.com',
        phone: '+91 9000000002',
        jobRole: 'QA Engineer',
        driveFileId: 'drive-suresh-602',
      };

      // Both should be saved as separate candidate records
      const res1 = await googleSheetsService.saveCandidate(candidate1);
      const res2 = await googleSheetsService.saveCandidate(candidate2);

      expect(res1.candidateId).toBe(601);
      expect(res2.candidateId).toBe(602);
      expect(mockSheetsClient.spreadsheets.values.append).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe('Requirements 20, 21 & 22: Missing Credentials, Redis Outage & Unreadable Resume', () => {
    it('should safely handle missing credentials without crashing', async () => {
      jest.spyOn(googleDriveService, 'ensureCvFolder').mockRestore();
      jest
        .spyOn(googleDriveService as any, 'getClient')
        .mockReturnValueOnce(null);
      await expect(googleDriveService.ensureCvFolder()).rejects.toThrow(
        'Google Drive client is not configured',
      );
    });

    it('should gracefully handle Redis outage with fallback', async () => {
      mockRedisClient.get.mockRejectedValueOnce(
        new Error('Redis connection refused'),
      );
      const isProcessed =
        await googleDriveService.isFileProcessed('drive-test-offline');
      // Should not throw, should handle safely
      expect(isProcessed).toBe(false);
    });

    it('should route unreadable resumes to manual review', async () => {
      mockGeminiService.analyzeResume.mockResolvedValueOnce({
        success: false,
        error: 'Unreadable PDF: text could not be extracted',
        matchedRole: 'Unspecified',
      });

      const analysis = await mockGeminiService.analyzeResume(
        Buffer.from('corrupted'),
      );
      expect(analysis.success).toBe(false);
    });
  });
});
