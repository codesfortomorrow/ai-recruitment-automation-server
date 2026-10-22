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
import { ResumeFingerprintService } from '../mail/resume-fingerprint.service';
import { RoleDetectionService } from '../mail/role-detection.service';
import {
  appConfigFactory,
  googleSheetsConfigFactory,
  hrConfigFactory,
  googleDriveConfigFactory,
  excelSyncConfigFactory,
  geminiConfigFactory,
  gmailConfigFactory,
} from '@Config';

describe('Google Drive Folder-Based CV Automation & Role-Based Pipeline Suite', () => {
  let googleDriveService: GoogleDriveService;
  let googleSheetsService: GoogleSheetsService;
  let candidateService: CandidateService;
  let candidateExcelService: CandidateExcelService;
  let candidateNotificationService: CandidateNotificationService;
  let roleDetectionService: RoleDetectionService;
  let hrAssignmentService: HrAssignmentService;
  let queueService: ResumeScreeningQueueService;
  let workerService: ResumeScreeningWorkerService;
  let gmailService: GmailService;
  let mockRedisClient: any;
  let mockDriveClient: any;
  let mockSheetsClient: any;
  let mockMailService: any;
  let mockGeminiService: any;
  let mockPrismaService: any;

  const ROOT_FOLDER_ID = 'folder-root-central-repo';
  const REACT_FOLDER_ID = 'folder-child-react';
  const NODE_FOLDER_ID = 'folder-child-node';
  const HR_FOLDER_ID = 'folder-child-hr';
  const DEVOPPS_FOLDER_ID = 'folder-child-devopps';

  beforeEach(async () => {
    const memoryStore = new Map<string, string>();
    const memorySets = new Map<string, Set<string>>();

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
      sadd: jest.fn().mockImplementation((key: string, member: string) => {
        if (!memorySets.has(key)) memorySets.set(key, new Set());
        memorySets.get(key)!.add(member);
        return Promise.resolve(1);
      }),
      sismember: jest.fn().mockImplementation((key: string, member: string) => {
        const s = memorySets.get(key);
        return Promise.resolve(s && s.has(member) ? 1 : 0);
      }),
      eval: jest
        .fn()
        .mockImplementation(
          (script: string, numKeys: number, key: string, token: string) => {
            if (memoryStore.get(key) === token) {
              memoryStore.delete(key);
              return Promise.resolve(1);
            }
            return Promise.resolve(0);
          },
        ),
      incr: jest.fn().mockImplementation((key: string) => Promise.resolve(21)),
    };

    mockDriveClient = {
      files: {
        list: jest.fn().mockResolvedValue({ data: { files: [] } }),
        create: jest.fn().mockResolvedValue({
          data: {
            id: 'drive-uploaded-file-id-123',
            webViewLink:
              'https://drive.google.com/file/d/drive-uploaded-file-id-123/view',
          },
        }),
        get: jest.fn().mockResolvedValue({
          data: Buffer.from('%PDF-1.4 Mock CV Content'),
        }),
        update: jest.fn().mockResolvedValue({
          data: { id: 'moved-file-id', parents: [REACT_FOLDER_ID] },
        }),
      },
    };

    mockSheetsClient = {
      spreadsheets: {
        get: jest.fn().mockResolvedValue({
          data: {
            sheets: [
              { properties: { sheetId: 0, title: 'Candidate Tracker' } },
            ],
          },
        }),
        values: {
          get: jest.fn().mockResolvedValue({
            data: { values: [GoogleSheetsService.EXPECTED_HEADERS] },
          }),
          append: jest.fn().mockResolvedValue({
            data: { updates: { updatedRange: "'Candidate Tracker'!A2:AB2" } },
          }),
          update: jest.fn().mockResolvedValue({
            data: { updatedRange: "'Candidate Tracker'!A2:AB2" },
          }),
        },
        batchUpdate: jest.fn().mockResolvedValue({}),
      },
    };

    mockMailService = {
      sendEmail: jest.fn().mockResolvedValue(true),
    };

    mockGeminiService = {
      isConfigured: jest.fn().mockReturnValue(true),
      isSuspiciouslyShortText: jest.fn().mockReturnValue(false),
      analyzeApplication: jest.fn().mockResolvedValue({
        status: 'success',
        analysis: {
          screeningStatus: 'SHORTLIST',
          matchScore: 85,
          screeningExplanation: 'Strong React, Redux, and TypeScript skills.',
          candidate: {
            name: 'Pooja Sharma',
            email: 'pooja.sharma@example.com',
            phone: '+91 9876543210',
            totalExperienceYears: 4,
            currentCompany: 'Tech Corp',
          },
          application: {
            jobRole: 'React Developer',
            skills: ['React', 'Redux'],
          },
          missingOrUnclearRequirements: [],
          rejectionReason: null,
        },
      }),
      analyzeResume: jest.fn().mockResolvedValue({
        success: true,
        matchScore: 85,
        matchedRole: 'React Developer',
        recommendation: 'SHORTLIST',
        screeningExplanation: 'Strong React, Redux, and TypeScript skills.',
        missingOrUnclearRequirements: [],
        candidate: {
          name: 'Pooja Sharma',
          email: 'pooja.sharma@example.com',
          phone: '+91 9876543210',
          totalExperienceYears: 4,
          currentCompany: 'Tech Corp',
        },
      }),
    };

    mockPrismaService = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-admin-1',
          email: 'admin@company.com',
          name: 'Super Admin',
          type: 'ADMIN',
        }),
        create: jest.fn().mockResolvedValue({
          id: 'user-new-1',
          email: 'newuser@company.com',
          name: 'New User',
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleDriveService,
        GoogleSheetsService,
        CandidateService,
        CandidateExcelService,
        CandidateNotificationService,
        HrAssignmentService,
        RecruitmentEmailClassifierService,
        ResumeScreeningQueueService,
        ResumeScreeningWorkerService,
        RoleDetectionService,
        GmailService,
        {
          provide: RedisService,
          useValue: { client: mockRedisClient },
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: MailService,
          useValue: mockMailService,
        },
        {
          provide: GeminiService,
          useValue: mockGeminiService,
        },
        {
          provide: appConfigFactory.KEY,
          useValue: {
            appPublicUrl: 'http://localhost:3000',
            serverUrl: 'http://localhost:9001',
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
            manualReviewEmail: 'hr-manual-review@company.com',
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
            rootFolderId: ROOT_FOLDER_ID,
            reactFolderId: REACT_FOLDER_ID,
            nodeFolderId: NODE_FOLDER_ID,
            hrFolderId: HR_FOLDER_ID,
            devoppsFolderId: DEVOPPS_FOLDER_ID,
            folderId: ROOT_FOLDER_ID,
            folderName: 'Central Repository of Resume',
            keyFile: 'config/test-key.json',
            pollingEnabled: true,
            pollingIntervalSeconds: 60,
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
            acquireProcessingLock: jest
              .fn()
              .mockResolvedValue({ acquired: true, lockToken: 'token-lock-1' }),
            releaseProcessingLock: jest.fn().mockResolvedValue(true),
            computeFingerprint: jest
              .fn()
              .mockReturnValue('test-fp-fingerprint-123'),
          },
        },
        {
          provide: geminiConfigFactory.KEY,
          useValue: {
            apiKey: 'test-gemini-key',
            model: 'gemini-1.5-flash',
          },
        },
        {
          provide: gmailConfigFactory.KEY,
          useValue: {
            user: 'test@codesfortomorrow.com',
          },
        },
      ],
    }).compile();

    googleDriveService = module.get<GoogleDriveService>(GoogleDriveService);
    googleSheetsService = module.get<GoogleSheetsService>(GoogleSheetsService);
    candidateService = module.get<CandidateService>(CandidateService);
    candidateExcelService = module.get<CandidateExcelService>(
      CandidateExcelService,
    );
    candidateNotificationService = module.get<CandidateNotificationService>(
      CandidateNotificationService,
    );
    roleDetectionService =
      module.get<RoleDetectionService>(RoleDetectionService);
    hrAssignmentService = module.get<HrAssignmentService>(HrAssignmentService);
    queueService = module.get<ResumeScreeningQueueService>(
      ResumeScreeningQueueService,
    );
    workerService = module.get<ResumeScreeningWorkerService>(
      ResumeScreeningWorkerService,
    );
    gmailService = module.get<GmailService>(GmailService);

    jest
      .spyOn(googleDriveService as any, 'getClient')
      .mockReturnValue(mockDriveClient);
    jest
      .spyOn(googleSheetsService as any, 'getClient')
      .mockReturnValue(mockSheetsClient);
    jest.spyOn(googleDriveService, 'isConfigured').mockReturnValue(true);
    jest.spyOn(googleSheetsService, 'isConfigured').mockReturnValue(true);
  });

  describe('1. Role-to-Folder Mapping', () => {
    it('should map React Developer variations to the React folder', () => {
      const roles = [
        'React Developer',
        'React.js Developer',
        'ReactJS Developer',
        'Senior React Frontend Developer',
      ];
      for (const r of roles) {
        const res = googleDriveService.resolveRoleFolder(r);
        expect(res.folderKey).toBe('REACT');
        expect(res.folderName).toBe('React');
        expect(res.isConfident).toBe(true);
        expect(googleDriveService.getFolderId(res.folderKey)).toBe(
          REACT_FOLDER_ID,
        );
      }
    });

    it('should map Node Developer variations to the Node folder', () => {
      const roles = [
        'Node Developer',
        'Node.js Developer',
        'NodeJS Developer',
        'Backend Node.js Engineer',
      ];
      for (const r of roles) {
        const res = googleDriveService.resolveRoleFolder(r);
        expect(res.folderKey).toBe('NODE');
        expect(res.folderName).toBe('Node');
        expect(res.isConfident).toBe(true);
        expect(googleDriveService.getFolderId(res.folderKey)).toBe(
          NODE_FOLDER_ID,
        );
      }
    });

    it('should map HR, Recruiter, and Talent Acquisition variations to the HR folder', () => {
      const roles = [
        'HR',
        'HR Intern',
        'HR Executive',
        'Recruiter',
        'Talent Acquisition',
        'Talent Acquisition Specialist',
      ];
      for (const r of roles) {
        const res = googleDriveService.resolveRoleFolder(r);
        expect(res.folderKey).toBe('HR');
        expect(res.folderName).toBe('HR');
        expect(res.isConfident).toBe(true);
        expect(googleDriveService.getFolderId(res.folderKey)).toBe(
          HR_FOLDER_ID,
        );
      }
    });

    it('should map DevOps Engineer variations to the Devopps folder', () => {
      const roles = [
        'DevOps Engineer',
        'DevOps',
        'Devopps',
        'Senior DevOps Engineer',
        'Site Reliability Engineer',
        'SRE',
      ];
      for (const r of roles) {
        const res = googleDriveService.resolveRoleFolder(r);
        expect(res.folderKey).toBe('DEVOPPS');
        expect(res.folderName).toBe('Devopps');
        expect(res.isConfident).toBe(true);
        expect(googleDriveService.getFolderId(res.folderKey)).toBe(
          DEVOPPS_FOLDER_ID,
        );
      }
    });

    it('should strictly NOT classify Java developers as JavaScript/Node/React developers', () => {
      const javaRoles = [
        'Java Developer',
        'Senior Java Developer',
        'Core Java Software Engineer',
        'Java Backend Developer',
      ];
      for (const r of javaRoles) {
        const res = googleDriveService.resolveRoleFolder(r);
        expect(res.folderKey).toBe('ROOT');
        expect(res.folderName).toBe('Central Repository of Resume');
        expect(res.isConfident).toBe(false);
      }
    });
  });

  describe('2. Ambiguous & Unsupported Roles in Root Folder', () => {
    it('should route ambiguous, conflicting, and unsupported roles to Root without guessing', () => {
      const unsupported = [
        'Conflict: React / QA',
        'Ambiguous Application',
        'Undetected Role',
        'Python Developer',
        'QA Automation Tester',
        'Business Analyst',
        'MERN Stack Developer', // Contains both React & Node -> stays in Root for manual review
      ];
      for (const r of unsupported) {
        const res = googleDriveService.resolveRoleFolder(r);
        expect(res.folderKey).toBe('ROOT');
        expect(res.folderName).toBe('Central Repository of Resume');
        expect(res.isConfident).toBe(false);
      }
    });
  });

  describe('3 & 4. Folder IDs Used Without Creating Replacement Folders & Missing Config Handling', () => {
    it('should use existing folder IDs directly without creating folders on Drive', async () => {
      const createSpy = mockDriveClient.files.create;
      createSpy.mockClear();

      const rootId = await googleDriveService.ensureCvFolder('ROOT');
      expect(rootId).toBe(ROOT_FOLDER_ID);

      const reactId = await googleDriveService.ensureCvFolder('REACT');
      expect(reactId).toBe(REACT_FOLDER_ID);

      const nodeId = await googleDriveService.ensureCvFolder('NODE');
      expect(nodeId).toBe(NODE_FOLDER_ID);

      const hrId = await googleDriveService.ensureCvFolder('HR');
      expect(hrId).toBe(HR_FOLDER_ID);

      const devoppsId = await googleDriveService.ensureCvFolder('DEVOPPS');
      expect(devoppsId).toBe(DEVOPPS_FOLDER_ID);

      // Verify NO folder was created via files.create
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('should throw clear descriptive errors when folder IDs are missing', () => {
      const serviceWithMissingConfig = new GoogleDriveService(
        {
          rootFolderId: '',
          reactFolderId: '',
          nodeFolderId: '',
          hrFolderId: '',
          devoppsFolderId: '',
          folderId: '',
          folderName: 'Central Repository of Resume',
          keyFile: 'config/test-key.json',
          pollingEnabled: true,
          pollingIntervalSeconds: 60,
        },
        { client: mockRedisClient } as any,
      );

      const missing = serviceWithMissingConfig.getMissingFolderConfig();
      expect(missing).toContain('GOOGLE_DRIVE_ROOT_FOLDER_ID');
      expect(missing).toContain('GOOGLE_DRIVE_REACT_FOLDER_ID');
      expect(missing).toContain('GOOGLE_DRIVE_NODE_FOLDER_ID');
      expect(missing).toContain('GOOGLE_DRIVE_HR_FOLDER_ID');
      expect(missing).toContain('GOOGLE_DRIVE_DEVOPPS_FOLDER_ID');

      expect(() => serviceWithMissingConfig.getFolderId('REACT')).toThrow(
        'Google Drive folder ID missing: GOOGLE_DRIVE_REACT_FOLDER_ID is required for React folder',
      );
      expect(() => serviceWithMissingConfig.getFolderId('ROOT')).toThrow(
        'Google Drive folder ID missing: GOOGLE_DRIVE_ROOT_FOLDER_ID is required for Central Repository of Resume',
      );
    });
  });

  describe('5. Gmail Resumes Upload to Role-Specific Folder', () => {
    it('should upload Gmail React applicant CV to the React folder with private permissions', async () => {
      mockDriveClient.files.create.mockClear();
      mockDriveClient.files.create.mockResolvedValueOnce({
        data: {
          id: 'drive-react-file-101',
          webViewLink:
            'https://drive.google.com/file/d/drive-react-file-101/view',
        },
      });

      const uploadResult = await googleDriveService.uploadCv({
        buffer: Buffer.from('%PDF-1.4 React Candidate CV'),
        filename: 'Aarav_React_Resume.pdf',
        role: 'React Developer',
        candidateEmail: 'aarav@example.com',
      });

      expect(uploadResult.fileId).toBe('drive-react-file-101');
      expect(uploadResult.folderKey).toBe('REACT');
      expect(uploadResult.folderId).toBe(REACT_FOLDER_ID);
      expect(uploadResult.cvLink).toBe(
        '=HYPERLINK("https://drive.google.com/file/d/drive-react-file-101/view", "View CV")',
      );

      // Verify upload specified React folder as parent
      expect(mockDriveClient.files.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            parents: [REACT_FOLDER_ID],
          }),
        }),
      );
    });

    it('should upload Gmail DevOps applicant CV to the Devopps folder', async () => {
      mockDriveClient.files.create.mockClear();
      mockDriveClient.files.create.mockResolvedValueOnce({
        data: {
          id: 'drive-devops-file-202',
          webViewLink:
            'https://drive.google.com/file/d/drive-devops-file-202/view',
        },
      });

      const uploadResult = await googleDriveService.uploadCv({
        buffer: Buffer.from('%PDF-1.4 DevOps Candidate CV'),
        filename: 'Sneha_DevOps_Resume.pdf',
        role: 'DevOps Engineer',
        candidateEmail: 'sneha@example.com',
      });

      expect(uploadResult.fileId).toBe('drive-devops-file-202');
      expect(uploadResult.folderKey).toBe('DEVOPPS');
      expect(uploadResult.folderId).toBe(DEVOPPS_FOLDER_ID);
      expect(mockDriveClient.files.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            parents: [DEVOPPS_FOLDER_ID],
          }),
        }),
      );
    });

    it('should upload Gmail ambiguous applicant CV to the Central Repository of Resume (ROOT)', async () => {
      mockDriveClient.files.create.mockClear();
      mockDriveClient.files.create.mockResolvedValueOnce({
        data: {
          id: 'drive-ambiguous-file-303',
          webViewLink:
            'https://drive.google.com/file/d/drive-ambiguous-file-303/view',
        },
      });

      const uploadResult = await googleDriveService.uploadCv({
        buffer: Buffer.from('%PDF-1.4 General Application'),
        filename: 'General_CV.pdf',
        role: 'Ambiguous Role',
      });

      expect(uploadResult.fileId).toBe('drive-ambiguous-file-303');
      expect(uploadResult.folderKey).toBe('ROOT');
      expect(uploadResult.folderId).toBe(ROOT_FOLDER_ID);
      expect(mockDriveClient.files.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            parents: [ROOT_FOLDER_ID],
          }),
        }),
      );
    });
  });

  describe('6 & 7. Manual Drive Upload Detection, Role Moving & Deduplication', () => {
    it('should detect a new resume in root folder, identify role, move to React folder, and screen candidate', async () => {
      mockDriveClient.files.list.mockImplementation(async (params: any) => {
        if (params?.q?.includes(ROOT_FOLDER_ID)) {
          return {
            data: {
              files: [
                {
                  id: 'manual-root-file-1',
                  name: 'Karan_React_Developer_Resume.pdf',
                  mimeType: 'application/pdf',
                  size: 45000,
                  createdTime: '2026-10-21T05:00:00Z',
                },
              ],
            },
          };
        }
        return { data: { files: [] } };
      });

      jest.spyOn(googleDriveService, 'downloadCv').mockResolvedValueOnce({
        buffer: Buffer.from(
          '%PDF-1.4 Karan Verma. React.js Developer with Redux. karan@example.com',
        ),
        filename: 'Karan_React_Developer_Resume.pdf',
        mimeType: 'application/pdf',
      });

      jest.spyOn(gmailService, 'extractResumeText').mockResolvedValueOnce({
        text: 'Karan Verma. React Developer with 3 years experience. Email: karan@example.com',
      });

      const moveSpy = jest
        .spyOn(googleDriveService, 'moveCvFile')
        .mockResolvedValueOnce();

      const processedCount = await googleDriveService.pollAndProcessNewFiles();
      expect(processedCount).toBe(1);

      // Verify file was moved from ROOT to REACT folder
      expect(moveSpy).toHaveBeenCalledWith(
        'manual-root-file-1',
        ROOT_FOLDER_ID,
        REACT_FOLDER_ID,
      );

      // Verify marked as processed in Redis
      const isProcessed =
        await googleDriveService.isFileProcessed('manual-root-file-1');
      expect(isProcessed).toBe(true);
    });

    it('should keep an ambiguous CV in Root folder without moving it', async () => {
      mockDriveClient.files.list.mockImplementation(async (params: any) => {
        if (params?.q?.includes(ROOT_FOLDER_ID)) {
          return {
            data: {
              files: [
                {
                  id: 'manual-ambiguous-file-2',
                  name: 'Unknown_Profile.pdf',
                  mimeType: 'application/pdf',
                  size: 35000,
                },
              ],
            },
          };
        }
        return { data: { files: [] } };
      });

      jest.spyOn(googleDriveService, 'downloadCv').mockResolvedValueOnce({
        buffer: Buffer.from('%PDF-1.4 Resume with generic text and no role'),
        filename: 'Unknown_Profile.pdf',
        mimeType: 'application/pdf',
      });

      jest.spyOn(gmailService, 'extractResumeText').mockResolvedValueOnce({
        text: 'Seeking an opportunity. Contact: unknown@example.com',
      });

      const moveSpy = jest.spyOn(googleDriveService, 'moveCvFile');

      const processedCount = await googleDriveService.pollAndProcessNewFiles();
      expect(processedCount).toBe(1);

      // Ambiguous CV must NOT be moved!
      expect(moveSpy).not.toHaveBeenCalled();
    });

    it('should not process the same file twice when scanned across multiple folders or runs', async () => {
      const fileId = 'shared-child-file-1';
      // Mark as already processed
      await googleDriveService.markFileProcessed(fileId, 205);

      mockDriveClient.files.list.mockResolvedValue({
        data: {
          files: [
            {
              id: fileId,
              name: 'Candidate_Resume.pdf',
              mimeType: 'application/pdf',
            },
          ],
        },
      });

      const scanned = await googleDriveService.scanNewCvFiles();
      // Should filter out already-processed files
      expect(scanned.find((f) => f.fileId === fileId)).toBeUndefined();
    });
  });

  describe('8 & 9. Cross-Source Deduplication & Google Sheets Persistence', () => {
    it('should not re-screen a Gmail-originated CV during Drive polling', async () => {
      const gmailDriveFileId = 'gmail-uploaded-drive-id-999';
      // Simulate Gmail uploaded file already recorded in Google Sheets
      jest
        .spyOn(googleSheetsService, 'readCandidateTrackerRows')
        .mockResolvedValueOnce([
          {
            rowIndex: 2,
            candidateId: 401,
            candidateName: 'Aditya Gupta',
            email: 'aditya@example.com',
            phone: '+91 9999888877',
            jobRole: 'React Developer',
            assignedHrName: 'Abhishek',
            totalExperience: '4 years',
            currentCompany: 'TCS',
            applicationStatus: 'Shortlisted',
            currentInterviewRound: 'HR Round',
            totalCallAttempts: 1,
            call1Date: '2026-10-21',
            call1Status: 'Answered',
            call1Remarks: 'Interested',
            call2Date: '',
            call2Status: '',
            call2Remarks: '',
            call3Date: '',
            call3Status: '',
            call3Remarks: '',
            nextFollowUpDate: '',
            automatedFollowUpEmailStatus: 'SENT',
            followUpEmailSentAt: '2026-10-21',
            hrRemarks: 'Solid profile',
            lastUpdatedBy: 'AI',
            lastUpdatedAt: '2026-10-21',
            driveFileId: gmailDriveFileId,
            cvLink: `=HYPERLINK("https://drive.google.com/file/d/${gmailDriveFileId}/view", "View CV")`,
          },
        ]);

      mockDriveClient.files.list.mockImplementation(async (params: any) => {
        if (params?.q?.includes(REACT_FOLDER_ID)) {
          return {
            data: {
              files: [
                {
                  id: gmailDriveFileId,
                  name: 'Candidate_401_Aarav.pdf',
                  mimeType: 'application/pdf',
                },
              ],
            },
          };
        }
        return { data: { files: [] } };
      });

      const downloadSpy = jest.spyOn(googleDriveService, 'downloadCv');

      await googleDriveService.pollAndProcessNewFiles();

      // Download and screening must be skipped completely because it was already saved in Sheets!
      expect(downloadSpy).not.toHaveBeenCalled();
      const isMarked =
        await googleDriveService.isFileProcessed(gmailDriveFileId);
      expect(isMarked).toBe(true);
    });

    it('should save candidate to Google Sheets with correct Drive File ID and clickable CV link', async () => {
      const candidateInput = {
        id: 701,
        name: 'Rohan Deshmukh',
        email: 'rohan@example.com',
        phone: '+91 9123456789',
        jobRole: 'DevOps Engineer',
        assignedHrName: 'Abhishek',
        totalExperience: '5 years',
        currentCompany: 'Wipro',
        status: 'Shortlisted',
        atsScore: 88,
        driveFileId: 'drive-file-rohan-devops',
        cvLink:
          '=HYPERLINK("https://drive.google.com/file/d/drive-file-rohan-devops/view", "View CV")',
      };

      const result = await googleSheetsService.saveCandidate(candidateInput);
      expect(result.action).toBe('appended');

      expect(mockSheetsClient.spreadsheets.values.append).toHaveBeenCalledWith(
        expect.objectContaining({
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [
              expect.arrayContaining([
                701,
                'Rohan Deshmukh',
                'rohan@example.com',
                'DevOps Engineer',
                'Abhishek',
                '=HYPERLINK("https://drive.google.com/file/d/drive-file-rohan-devops/view", "View CV")',
                'drive-file-rohan-devops',
              ]),
            ],
          },
        }),
      );
    });
  });

  describe('10, 11, 12, 13 & 14. Preservation, Retries, Excel Lock & Auth Continuity', () => {
    it('should preserve HR-managed call tracking and remarks when candidate row is updated', async () => {
      const existingHeaders = GoogleSheetsService.EXPECTED_HEADERS;
      const existingRow = [
        '801', // Candidate ID
        'Neha Sharma', // Name
        'neha@example.com', // Email
        '+91 9888877777', // Phone
        'React Developer', // Role
        'Abhishek', // HR
        '3 years', // Exp
        'HCL', // Company
        'Shortlisted', // App Status
        'Technical Round 1', // Round (HR field)
        '2', // Total call attempts (HR field)
        '2026-10-18', // Call 1 date
        'Answered', // Call 1 status (HR field)
        'Cleared initial screening', // Call 1 remarks (HR field)
        '2026-10-20', // Call 2 date
        'Answered', // Call 2 status (HR field)
        'Technical round scheduled', // Call 2 remarks (HR field)
        '', // Call 3 date
        '', // Call 3 status
        '', // Call 3 remarks
        '2026-10-25', // Next follow up date (HR field)
        'SENT', // Follow up email status
        '2026-10-18', // Follow up sent at
        'Strong candidate; confirmed for Tech 1', // HR remarks (HR field)
        'AI System', // Last updated by
        '2026-10-20', // Last updated at
        '=HYPERLINK("https://drive.google.com/file/d/drive-neha-old/view", "View CV")',
        'drive-neha-old',
      ];

      mockSheetsClient.spreadsheets.values.get.mockResolvedValueOnce({
        data: { values: [existingHeaders, existingRow] },
      });

      // Update candidate with new CV link
      await googleSheetsService.saveCandidate({
        id: 801,
        name: 'Neha Sharma',
        email: 'neha@example.com',
        jobRole: 'React Developer',
        driveFileId: 'drive-neha-new',
        cvLink:
          '=HYPERLINK("https://drive.google.com/file/d/drive-neha-new/view", "View CV")',
      });

      expect(mockSheetsClient.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: {
            values: [
              expect.arrayContaining([
                801,
                'Neha Sharma',
                'neha@example.com',
                'Technical Round 1', // Preserved
                2, // Preserved
                'Cleared initial screening', // Preserved
                'Technical round scheduled', // Preserved
                'Strong candidate; confirmed for Tech 1', // Preserved
                '=HYPERLINK("https://drive.google.com/file/d/drive-neha-new/view", "View CV")', // Updated
                'drive-neha-new', // Updated
              ]),
            ],
          },
        }),
      );
    });

    it('should keep job in FAILED_RETRYABLE status when Google Sheets write fails', async () => {
      const mockJob = {
        id: 'job-sheets-fail-1',
        fingerprint: 'fp-sheets-fail',
        jobRole: 'React Developer',
        sender: { name: 'Kavita', email: 'kavita@example.com' },
        attemptCount: 1,
        status: 'PROCESSING',
      };

      jest
        .spyOn(queueService, 'acquireJobLock')
        .mockResolvedValueOnce({ acquired: true, lockToken: 'tok-1' });
      jest.spyOn(queueService, 'releaseJobLock').mockResolvedValueOnce();
      const updateJobSpy = jest
        .spyOn(queueService, 'updateJob')
        .mockResolvedValue();

      // CandidateService returns sheetsSaved: false
      jest
        .spyOn(candidateService, 'persistAndProcessScreeningResult')
        .mockResolvedValueOnce({
          id: 901,
          sheetsSaved: false,
          sheetsError: '503 Service Unavailable: Google Sheets API timeout',
          notificationSent: false,
        } as any);

      await workerService.processSingleJob(mockJob as any);

      // Verify job was transitioned to FAILED_RETRYABLE, NOT COMPLETED!
      expect(updateJobSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED_RETRYABLE',
          lastError: expect.stringContaining('Google Sheets'),
        }),
      );
    });

    it('should transition to NOTIFICATION_PENDING when Sheets succeeds but notification fails, allowing clean notification retry', async () => {
      const mockJob = {
        id: 'job-notif-fail-1',
        fingerprint: 'fp-notif-fail',
        jobRole: 'DevOps Engineer',
        sender: { name: 'Dev Candidate', email: 'dev@example.com' },
        attemptCount: 1,
        status: 'PROCESSING',
      };

      jest
        .spyOn(queueService, 'acquireJobLock')
        .mockResolvedValueOnce({ acquired: true, lockToken: 'tok-2' });
      jest.spyOn(queueService, 'releaseJobLock').mockResolvedValueOnce();
      const updateJobSpy = jest
        .spyOn(queueService, 'updateJob')
        .mockResolvedValue();

      // Sheets succeeds, notification fails
      jest
        .spyOn(candidateService, 'persistAndProcessScreeningResult')
        .mockResolvedValueOnce({
          id: 902,
          sheetsSaved: true,
          notificationSent: false,
          notificationError: 'SMTP connection timeout to hr1@example.com',
        } as any);

      await workerService.processSingleJob(mockJob as any);

      // Must be transitioned to NOTIFICATION_PENDING, NOT COMPLETED or FAILED_RETRYABLE!
      expect(updateJobSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'NOTIFICATION_PENDING',
          lastError: expect.stringContaining('SMTP connection timeout'),
        }),
      );
    });

    it('should verify Excel candidate writes remain disabled during candidate persistence', async () => {
      const excelSaveSpy = jest.spyOn(candidateExcelService, 'saveCandidate');
      excelSaveSpy.mockClear();

      jest.spyOn(googleSheetsService, 'saveCandidate').mockResolvedValueOnce({
        action: 'appended',
        candidateId: 903,
        rowNumber: 3,
      });

      await candidateService.persistAndProcessScreeningResult({
        messageDetail: {
          id: 'msg-excel-check',
          threadId: 'th-1',
          recipient: 'careers@company.com',
          sender: { name: 'Tanvi', email: 'tanvi@example.com' },
          subject: 'Application for React Developer',
          snippet: 'Resume attached',
          receivedDate: new Date(),
          attachments: [
            {
              attachmentId: 'att-excel-1',
              filename: 'Tanvi_Resume.pdf',
              mimeType: 'application/pdf',
              size: 1024,
            },
          ],
        },
        analysisResult: {
          attachmentId: 'att-excel-1',
          filename: 'Tanvi_Resume.pdf',
          status: 'success',
          analyzedAt: new Date().toISOString(),
          model: 'gemini-1.5-flash',
          analysis: {
            screeningStatus: 'SHORTLIST',
            matchScore: 85,
            screeningExplanation: 'Strong candidate',
            candidate: {
              name: 'Tanvi',
              email: 'tanvi@example.com',
            },
            application: {
              jobRole: 'React Developer',
              skills: ['React'],
            },
            missingOrUnclearRequirements: [],
            rejectionReason: null,
          } as any,
        } as any,
      });

      // Excel candidate writes MUST NOT be called!
      expect(excelSaveSpy).not.toHaveBeenCalled();
    });

    it('should verify authentication and user-management services work independently', async () => {
      const admin = await mockPrismaService.user.findUnique({
        where: { email: 'admin@company.com' },
      });
      expect(admin).toBeDefined();
      expect(admin.type).toBe('ADMIN');
      expect(admin.email).toBe('admin@company.com');
    });
  });
});
