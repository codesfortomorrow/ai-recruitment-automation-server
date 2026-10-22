import { RoleDetectionService } from '../mail/role-detection.service';
import { CandidateExcelService } from './candidate-excel.service';
import { CandidateNotificationService } from './candidate-notification.service';
import { GoogleSheetsService } from './google-sheets.service';

describe('Audit & Repair Regression Test Suite', () => {
  describe('Phase Four: Role Resolution & Conflict Detection', () => {
    let roleDetectionService: RoleDetectionService;

    beforeEach(() => {
      roleDetectionService = new RoleDetectionService();
    });

    it('should resolve Backend Developer when subject is Backend Developer and body mentions generic Software Developer', () => {
      const result = roleDetectionService.resolveRole({
        subject: 'Application for Backend Developer - Rohit Dorage',
        emailBody:
          'Respected Sir, I am currently working as a Software Developer at YaraCircle. I would like to apply for the Backend Developer position.',
      });

      expect(result.status).toBe('RESOLVED');
      expect(result.canonicalRole).toBe('BACKEND_DEVELOPER');
      expect(result.role?.title).toBe('Backend Developer');
      expect(result.source).toBe('SUBJECT');
      expect(result.confidence).toBe('HIGH');
    });

    it('should resolve Backend Developer when subject is generic Software Developer and body has explicit intent for Backend Developer', () => {
      const result = roleDetectionService.resolveRole({
        subject: 'Job Application - Rohit Dorage',
        emailBody:
          'Dear Hiring Manager, I am applying for the role of Backend Developer at Codes for Tomorrow.',
      });

      expect(result.status).toBe('RESOLVED');
      expect(result.canonicalRole).toBe('BACKEND_DEVELOPER');
      expect(result.role?.title).toBe('Backend Developer');
      expect(result.source).toBe('BODY');
    });

    it('should flag true conflict when subject is Developer and body has explicit intent for completely different domain', () => {
      const result = roleDetectionService.resolveRole({
        subject: 'Application for Backend Developer',
        emailBody:
          'Dear Hiring Team, I am applying for the role of HR Intern at Codes for Tomorrow.',
      });

      expect(result.status).toBe('CONFLICT');
      expect(result.canonicalRole).toBeNull();
      expect(result.reason).toBe('ROLE_CONFLICT');
    });
  });

  describe('Phase Three & Eight: Candidate ID Allocation & Notification Collision Protection', () => {
    it('should allocate atomic monotonic candidate IDs via Redis sequence', async () => {
      let redisSeq = 15;
      const mockRedisService: any = {
        client: {
          exists: jest.fn().mockResolvedValue(1),
          incr: jest.fn().mockImplementation(async () => ++redisSeq),
          set: jest.fn().mockResolvedValue('OK'),
          get: jest.fn().mockResolvedValue(null),
          keys: jest.fn().mockResolvedValue([]),
        },
      };

      const mockExcelConfig: any = {
        enabled: true,
        path: './data/candidates.xlsx',
        intervalMinutes: 2,
      };

      const excelService = new CandidateExcelService(
        mockExcelConfig,
        {} as any,
        {} as any,
        mockRedisService,
        {} as any,
        {} as any,
      );

      const id1 = await excelService.allocateNextCandidateId(15);
      const id2 = await excelService.allocateNextCandidateId(15);
      const id3 = await excelService.allocateNextCandidateId(15);

      expect(id1).toBe(16);
      expect(id2).toBe(17);
      expect(id3).toBe(18);
    });

    it('should not suppress Rohit Dorage notification when Vivek Urmaliya was previously notified under ID 16', async () => {
      const mockMailService: any = {
        sendDirect: jest.fn().mockResolvedValue({
          status: 'SENT',
          messageId: 'msg-test-rohit',
          response: '250 OK: Message accepted',
        }),
      };

      const redisStore = new Map<string, string>();
      // Vivek was previously sent under legacy key candidate:notified:16:abhigoud198484@gmail.com
      redisStore.set('candidate:notified:16:abhigoud198484@gmail.com', 'SENT');

      const mockRedisService: any = {
        client: {
          get: jest
            .fn()
            .mockImplementation(async (k: string) => redisStore.get(k) || null),
          set: jest.fn().mockImplementation(async (k: string, v: string) => {
            redisStore.set(k, v);
            return 'OK';
          }),
          del: jest.fn().mockResolvedValue(1),
          eval: jest.fn().mockResolvedValue(1),
        },
      };

      const mockHrConfig: any = {
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
      };

      const mockAppConfig: any = {
        publicUrl: 'http://localhost:9001',
      };

      const notificationService = new CandidateNotificationService(
        mockRedisService,
        mockMailService,
        {} as any,
        {} as any,
        mockHrConfig,
        mockAppConfig,
      );

      // Rohit Dorage application evaluated under candidate.id = 16
      const rohitCandidate = {
        id: 16,
        name: 'Rohit Dorage',
        email: 'rohitdorage100@gmail.com',
        jobRole: 'Backend Developer',
        assignedHrName: 'Abhishek',
        assignedHrEmail: 'abhigoud198484@gmail.com',
        screeningStatus: 'SHORTLIST',
        matchScore: 82,
        summary: 'Solid backend engineer',
        skills: ['Node.js', 'PostgreSQL'],
      };

      const result = await notificationService.notifyAssignedHr(rohitCandidate);

      // Crucial test: Notification must NOT be skipped as duplicate
      expect(result.status).toBe('Sent');
      expect(mockMailService.sendDirect).toHaveBeenCalledTimes(1);
      // Composite key must now be recorded
      expect(
        redisStore.get(
          'candidate:notified:16:rohitdorage100@gmail.com:abhigoud198484@gmail.com',
        ),
      ).toBe('SENT');
    });
  });

  describe('Phase Two: Google Sheets Configuration Status Inspection', () => {
    it('should report sanitized configuration issue when service account key is missing', () => {
      const mockSheetsConfig: any = {
        spreadsheetId: '10EZZAoFAjrlBWajSnS20tv6okr_SnjzYY19cBgbpSUk',
        keyFile: './config/missing-service-account.json',
        tabName: 'Candidate Tracker',
      };

      const sheetsService = new GoogleSheetsService(
        mockSheetsConfig,
        {} as any,
      );

      expect(sheetsService.isRequired()).toBe(true);
      expect(sheetsService.isConfigured()).toBe(false);
      expect(sheetsService.getSpreadsheetId()).toBe(
        '10EZZAoFAjrlBWajSnS20tv6okr_SnjzYY19cBgbpSUk',
      );

      const issue = sheetsService.getConfigurationIssue();
      expect(issue?.toLowerCase()).toContain(
        'service account key file not found',
      );
      expect(issue).not.toContain('private_key');
    });

    it('should successfully validate and configure when valid service account key file is provided', () => {
      const mockSheetsConfig: any = {
        spreadsheetId: '10EZZAoFAjrlBWajSnS20tv6okr_SnjzYY19cBgbpSUk',
        keyFile: './config/google-service-account.json',
        tabName: 'Candidate Tracker',
      };

      const sheetsService = new GoogleSheetsService(
        mockSheetsConfig,
        {} as any,
      );

      expect(sheetsService.isRequired()).toBe(true);
      expect(sheetsService.isConfigured()).toBe(true);
      expect(sheetsService.getConfigurationIssue()).toBe('');
      expect(sheetsService.getSpreadsheetId()).toBe(
        '10EZZAoFAjrlBWajSnS20tv6okr_SnjzYY19cBgbpSUk',
      );
    });

    it('should report configuration issue when service account JSON lacks required fields', () => {
      // package.json is valid JSON but lacks service_account fields
      const mockSheetsConfig: any = {
        spreadsheetId: '10EZZAoFAjrlBWajSnS20tv6okr_SnjzYY19cBgbpSUk',
        keyFile: './package.json',
        tabName: 'Candidate Tracker',
      };

      const sheetsService = new GoogleSheetsService(
        mockSheetsConfig,
        {} as any,
      );

      expect(sheetsService.isRequired()).toBe(true);
      expect(sheetsService.isConfigured()).toBe(false);
      const issue = sheetsService.getConfigurationIssue();
      expect(issue).toContain('missing required fields');
    });
  });
});
