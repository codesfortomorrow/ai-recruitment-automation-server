import { Test, TestingModule } from '@nestjs/testing';
import { google } from 'googleapis';
import { GoogleSheetsService } from './google-sheets.service';
import { CandidateService } from './candidate.service';
import { CandidateExcelService } from './candidate-excel.service';
import { HrAssignmentService } from './hr-assignment.service';
import { CandidateNotificationService } from './candidate-notification.service';
import { PrismaService } from '../prisma';
import { RedisService } from '../redis';
import { GmailService } from '../mail/gmail.service';
import { MailService } from '../mail/mail.service';
import { ResumeFingerprintService } from '../mail/resume-fingerprint.service';
import {
  googleSheetsConfigFactory,
  hrConfigFactory,
  mailConfigFactory,
} from '@Config';

describe('Google Sheets Mobile Number & Default HR Call Status', () => {
  let googleSheetsService: GoogleSheetsService;
  let candidateService: CandidateService;
  let candidateExcelService: CandidateExcelService;
  let mockSheetsClient: any;
  let redisStore: Map<string, string>;

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

    mockSheetsClient = {
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
            data: {
              values: [GoogleSheetsService.EXPECTED_HEADERS],
            },
          }),
          append: jest.fn().mockResolvedValue({
            data: {
              updates: {
                updatedRange: "'Candidate Tracker'!A2:Z2",
              },
            },
          }),
          update: jest.fn().mockResolvedValue({
            data: {
              updatedRange: "'Candidate Tracker'!A2:Z2",
            },
          }),
          batchUpdate: jest.fn().mockResolvedValue({ data: {} }),
          clear: jest.fn().mockResolvedValue({ data: {} }),
        },
        batchUpdate: jest.fn().mockResolvedValue({
          data: {
            replies: [],
          },
        }),
      },
    };

    jest.spyOn(google, 'sheets').mockReturnValue(mockSheetsClient as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleSheetsService,
        CandidateService,
        {
          provide: CandidateExcelService,
          useValue: {
            saveCandidate: jest.fn().mockImplementation(async (input: any) => ({
              id: input.id || 101,
              ...input,
            })),
            getCandidateById: jest.fn().mockResolvedValue(null),
            findCandidates: jest.fn().mockResolvedValue({ data: [] }),
          },
        },
        {
          provide: HrAssignmentService,
          useValue: {
            assignHr: jest.fn().mockReturnValue({
              id: 'hr-1',
              name: 'Aastha Negi',
              email: 'aastha@example.com',
              canonicalRole: 'HR Intern',
            }),
            normalizeJobRole: jest.fn().mockReturnValue('HR Intern'),
          },
        },
        {
          provide: CandidateNotificationService,
          useValue: {
            notifyHrOfCandidate: jest.fn().mockResolvedValue({ success: true }),
            notifyAssignedHr: jest.fn().mockResolvedValue({ success: true }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            candidate: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              upsert: jest.fn().mockImplementation(async (args) => args.create),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            client: mockRedisClient,
          },
        },
        {
          provide: googleSheetsConfigFactory.KEY,
          useValue: {
            spreadsheetId: 'test-spreadsheet-id',
            keyFile: './test-key.json',
            tabName: 'Candidate Tracker',
            pollingEnabled: true,
            pollingIntervalMinutes: 2,
          },
        },
        {
          provide: hrConfigFactory.KEY,
          useValue: {
            manualReviewEmail: 'hr@example.com',
          },
        },
        {
          provide: GmailService,
          useValue: {
            sendEmail: jest
              .fn()
              .mockResolvedValue({ messageId: 'msg-1', status: 'SENT' }),
            downloadAttachment: jest
              .fn()
              .mockResolvedValue(Buffer.from('%PDF-1.4')),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendDirect: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
          },
        },
        {
          provide: ResumeFingerprintService,
          useValue: {
            computeFingerprint: jest.fn().mockReturnValue('mock-hash'),
            isFingerprintProcessed: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: mailConfigFactory.KEY,
          useValue: {
            fromAddress: 'recruitment@example.com',
          },
        },
      ],
    }).compile();

    googleSheetsService = module.get<GoogleSheetsService>(GoogleSheetsService);
    candidateService = module.get<CandidateService>(CandidateService);
    candidateExcelService = module.get<CandidateExcelService>(
      CandidateExcelService,
    );

    // Mock getClient and isConfigured on GoogleSheetsService
    jest
      .spyOn(googleSheetsService as any, 'getClient')
      .mockReturnValue(mockSheetsClient);
    jest.spyOn(googleSheetsService, 'isConfigured').mockReturnValue(true);
  });

  // =========================================================================
  // 1. Mobile Number Formatting & Formula Error Prevention
  // =========================================================================
  describe('1. Mobile Number Formatting & Formula Error Prevention', () => {
    it('should format +91 7000310666 as clean string without formula error or apostrophe', () => {
      const formatted =
        googleSheetsService.formatPhoneNumberForSheet('+91 7000310666');
      expect(formatted).toBe('+91 7000310666');
      expect(formatted.startsWith('+')).toBe(true);
      expect(formatted.includes(' ')).toBe(true);
    });

    it('should format +91 without a space correctly', () => {
      const formatted =
        googleSheetsService.formatPhoneNumberForSheet('+917000310666');
      expect(formatted).toBe('+917000310666');
    });

    it('should preserve leading zeros correctly', () => {
      const formatted =
        googleSheetsService.formatPhoneNumberForSheet('07000310666');
      expect(formatted).toBe('07000310666');
      expect(formatted.startsWith('0')).toBe(true);
    });

    it('should preserve numbers without a country code', () => {
      const formatted =
        googleSheetsService.formatPhoneNumberForSheet('7000310666');
      expect(formatted).toBe('7000310666');
    });

    it('should strip unnecessary leading apostrophes so backend does not store apostrophes', () => {
      const formatted =
        googleSheetsService.formatPhoneNumberForSheet("'+91 7000310666");
      expect(formatted).toBe('+91 7000310666');
      expect(formatted.includes("'")).toBe(false);
    });

    it('should clean legacy corrupted #ERROR! values from sheet', () => {
      expect(googleSheetsService.formatPhoneNumberForSheet('#ERROR!')).toBe('');
      expect(googleSheetsService.formatPhoneNumberForSheet('#VALUE!')).toBe('');
      expect(googleSheetsService.formatPhoneNumberForSheet(null)).toBe('');
      expect(googleSheetsService.formatPhoneNumberForSheet(undefined)).toBe('');
    });

    it('should write candidate data using valueInputOption: "RAW" on append', async () => {
      await googleSheetsService.saveCandidate({
        id: 101,
        name: 'Priya Sharma',
        email: 'priya@example.com',
        phone: '+91 7000310666',
        jobRole: 'HR Intern',
      });

      expect(mockSheetsClient.spreadsheets.values.append).toHaveBeenCalledWith(
        expect.objectContaining({
          valueInputOption: 'RAW',
          requestBody: {
            values: [expect.arrayContaining(['+91 7000310666'])],
          },
        }),
      );

      // Verify the phone is at column index 3 (Column D: Mobile Number)
      const appendedRow =
        mockSheetsClient.spreadsheets.values.append.mock.calls[0][0].requestBody
          .values[0];
      expect(appendedRow[3]).toBe('+91 7000310666');
    });

    it('should write candidate data using valueInputOption: "RAW" on update', async () => {
      // Mock existing row with candidate ID 101
      const existingRow = new Array(26).fill('');
      existingRow[0] = '101';
      existingRow[1] = 'Priya Sharma';
      existingRow[2] = 'priya@example.com';
      existingRow[3] = '+91 7000310666';

      mockSheetsClient.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          values: [GoogleSheetsService.EXPECTED_HEADERS, existingRow],
        },
      });

      await googleSheetsService.saveCandidate({
        id: 101,
        name: 'Priya Sharma',
        email: 'priya@example.com',
        phone: '+91 7000310666',
        jobRole: 'HR Intern',
      });

      expect(mockSheetsClient.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: "'Candidate Tracker'!A2:AB2",
          valueInputOption: 'RAW',
          requestBody: {
            values: [expect.arrayContaining(['+91 7000310666'])],
          },
        }),
      );
    });

    it('should format column D (Mobile Number) as plain text in ensureSheetColumnValidationsAndFormatting', async () => {
      await googleSheetsService.ensureSheetColumnValidationsAndFormatting(
        mockSheetsClient,
        'test-spreadsheet-id',
        0,
        1000,
      );

      const batchCalls = mockSheetsClient.spreadsheets.batchUpdate.mock.calls;
      const requests = batchCalls[0][0].requestBody.requests;

      // Find repeatCell request targeting column D (startColumnIndex: 3, endColumnIndex: 4)
      const colDFormat = requests.find(
        (r: any) =>
          r.repeatCell &&
          r.repeatCell.range?.startColumnIndex === 3 &&
          r.repeatCell.range?.endColumnIndex === 4,
      );

      expect(colDFormat).toBeDefined();
      expect(
        colDFormat.repeatCell.cell.userEnteredFormat.numberFormat.type,
      ).toBe('TEXT');
    });

    it('should format column D (Mobile Number) as plain text in ensureCandidateRowFormatting', async () => {
      await googleSheetsService.ensureCandidateRowFormatting(
        mockSheetsClient,
        'test-spreadsheet-id',
        0,
        2,
      );

      const batchCalls = mockSheetsClient.spreadsheets.batchUpdate.mock.calls;
      const requests = batchCalls[0][0].requestBody.requests;

      const colDFormat = requests.find(
        (r: any) =>
          r.repeatCell &&
          r.repeatCell.range?.startColumnIndex === 3 &&
          r.repeatCell.range?.endColumnIndex === 4,
      );

      expect(colDFormat).toBeDefined();
      expect(
        colDFormat.repeatCell.cell.userEnteredFormat.numberFormat.type,
      ).toBe('TEXT');
    });
  });

  // =========================================================================
  // 2. Keep All Call Status Fields Blank by Default (HR-Controlled)
  // =========================================================================
  describe('2. Keep All Call Status Fields Blank by Default (HR-Controlled)', () => {
    it('should leave Column M, P, and S blank on new candidate row by default', async () => {
      await googleSheetsService.saveCandidate({
        id: 201,
        name: 'Amit Patel',
        email: 'amit@example.com',
        phone: '+91 9876543210',
        jobRole: 'HR Executive',
      });

      const appendedRow =
        mockSheetsClient.spreadsheets.values.append.mock.calls[0][0].requestBody
          .values[0];

      // Column K (index 10): Total Call Attempts = 0 (no call attempt made yet)
      expect(appendedRow[10]).toBe(0);
      // Column L (index 11): 1st Call Date = ''
      expect(appendedRow[11]).toBe('');
      // Column M (index 12): 1st Call Status = '' (blank!)
      expect(appendedRow[12]).toBe('');
      // Column N (index 13): 1st Call Remarks = ''
      expect(appendedRow[13]).toBe('');
      // Column O (index 14): 2nd Call Date = ''
      expect(appendedRow[14]).toBe('');
      // Column P (index 15): 2nd Call Status = '' (blank!)
      expect(appendedRow[15]).toBe('');
      // Column Q (index 16): 2nd Call Remarks = ''
      expect(appendedRow[16]).toBe('');
      // Column R (index 17): 3rd Call Date = ''
      expect(appendedRow[17]).toBe('');
      // Column S (index 18): 3rd Call Status = '' (blank!)
      expect(appendedRow[18]).toBe('');
      // Column T (index 19): 3rd Call Remarks = ''
      expect(appendedRow[19]).toBe('');
    });

    it('should verify HR can select any status from dropdown matching GoogleSheetsService.CALL_STATUS_OPTIONS', () => {
      expect(GoogleSheetsService.CALL_STATUS_OPTIONS).toEqual([
        'Not Answered',
        'Answered',
        'Busy',
        'Call Back Requested',
        'Invalid Number',
        'Switched Off',
      ]);
    });

    it('should preserve existing HR-entered call status, dates, and remarks during subsequent candidate update', async () => {
      // Existing row with HR data
      const existingRow = new Array(26).fill('');
      existingRow[0] = '201';
      existingRow[1] = 'Amit Patel';
      existingRow[2] = 'amit@example.com';
      existingRow[3] = '+91 9876543210';
      existingRow[10] = 1; // Total Call Attempts: 1
      existingRow[11] = '2026-10-18 10:00:00'; // 1st Call Date
      existingRow[12] = 'Answered'; // HR manually marked as Answered!
      existingRow[13] = 'Interested in role, scheduled interview';
      existingRow[14] = '';
      existingRow[15] = '';
      existingRow[20] = '2026-10-20'; // Next Follow-up Date
      existingRow[23] = 'Candidate has good communication';

      mockSheetsClient.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          values: [GoogleSheetsService.EXPECTED_HEADERS, existingRow],
        },
      });

      // Subsequent sync runs (e.g. metadata refresh)
      await googleSheetsService.saveCandidate({
        id: 201,
        name: 'Amit Patel',
        email: 'amit@example.com',
        phone: '+91 9876543210',
        jobRole: 'HR Executive',
        // Note: No new call data provided
      });

      const updatedRow =
        mockSheetsClient.spreadsheets.values.update.mock.calls[0][0].requestBody
          .values[0];

      // Must NOT overwrite HR-entered 'Answered' with blank or default!
      expect(updatedRow[12]).toBe('Answered');
      expect(updatedRow[11]).toBe('2026-10-18 10:00:00');
      expect(updatedRow[13]).toBe('Interested in role, scheduled interview');
      expect(updatedRow[20]).toBe('2026-10-20');
      expect(updatedRow[23]).toBe('Candidate has good communication');
    });

    it('should preserve blank call status on an existing candidate row during update if HR has not selected one', async () => {
      // Existing row that has an empty call1Status
      const existingRow = new Array(26).fill('');
      existingRow[0] = '202';
      existingRow[1] = 'Uncalled Candidate';
      existingRow[2] = 'uncalled@example.com';
      existingRow[3] = '9876543211';
      existingRow[12] = ''; // empty call status

      mockSheetsClient.spreadsheets.values.get.mockResolvedValueOnce({
        data: {
          values: [GoogleSheetsService.EXPECTED_HEADERS, existingRow],
        },
      });

      await googleSheetsService.saveCandidate({
        id: 202,
        name: 'Uncalled Candidate',
        email: 'uncalled@example.com',
        phone: '9876543211',
      });

      const updatedRow =
        mockSheetsClient.spreadsheets.values.update.mock.calls[0][0].requestBody
          .values[0];
      // Remains blank, not auto-populated!
      expect(updatedRow[12]).toBe('');
    });
  });

  // =========================================================================
  // 3. Candidate Screening Lifecycle & Timing
  // =========================================================================
  describe('3. Candidate Screening Lifecycle & Timing', () => {
    it('should leave call status M, P, S blank immediately when screening succeeds', async () => {
      const mockDetail: any = {
        id: 'msg-screen-success',
        threadId: 'msg-screen-success',
        sender: { email: 'deepak@example.com', name: 'Deepak Rao' },
        subject: 'Application for HR Intern',
        attachments: [
          { attachmentId: 'att-screen-1', filename: 'deepak_resume.pdf' },
        ],
      };

      const mockAnalysisResult: any = {
        status: 'success',
        attachmentId: 'att-screen-1',
        filename: 'deepak_resume.pdf',
        analysis: {
          candidate: {
            name: 'Deepak Rao',
            email: 'deepak@example.com',
            phone: '+91 7000310666',
            experience: [],
          },
          application: {
            jobRole: 'HR Intern',
            experience: [],
          },
          screeningStatus: 'SHORTLIST',
          matchScore: 88,
          summary: 'Candidate qualified for HR Intern role',
          screeningExplanation: 'Strong recruitment concepts',
          matchedRequirements: ['Communication'],
          missingOrUnclearRequirements: [],
        },
      };

      await candidateService.persistAndProcessScreeningResult({
        messageDetail: mockDetail,
        analysisResult: mockAnalysisResult,
      });

      // Verify CandidateExcelService did NOT receive any writes (Google Sheets is only permanent store)
      expect(candidateExcelService.saveCandidate).not.toHaveBeenCalled();

      // Verify GoogleSheetsService was called on candidate creation
      expect(mockSheetsClient.spreadsheets.values.append).toHaveBeenCalledWith(
        expect.objectContaining({
          valueInputOption: 'RAW',
        }),
      );

      const appendedRow =
        mockSheetsClient.spreadsheets.values.append.mock.calls[0][0].requestBody
          .values[0];
      expect(appendedRow[3]).toBe('+91 7000310666');
      // All call statuses blank by default:
      expect(appendedRow[12]).toBe('');
      expect(appendedRow[15]).toBe('');
      expect(appendedRow[18]).toBe('');
    });

    it('should NOT call saveCandidate or initialize call status if screening has failed or result is invalid', async () => {
      mockSheetsClient.spreadsheets.values.append.mockClear();
      mockSheetsClient.spreadsheets.values.update.mockClear();
      (candidateExcelService.saveCandidate as jest.Mock).mockClear();

      const mockDetail: any = {
        id: 'msg-screen-failed',
        sender: { email: 'failed@example.com', name: 'Failed Candidate' },
        subject: 'Application',
        attachments: [
          { attachmentId: 'att-fail-1', filename: 'corrupted.pdf' },
        ],
      };

      const mockFailedResult: any = {
        status: 'failed',
        attachmentId: 'att-fail-1',
        filename: 'corrupted.pdf',
        error: 'Screening failed due to Gemini error',
      };

      const result = await candidateService.persistAndProcessScreeningResult({
        messageDetail: mockDetail,
        analysisResult: mockFailedResult,
      });

      expect(result).toBeNull();
      expect(candidateExcelService.saveCandidate).not.toHaveBeenCalled();
      expect(
        mockSheetsClient.spreadsheets.values.append,
      ).not.toHaveBeenCalled();
      expect(
        mockSheetsClient.spreadsheets.values.update,
      ).not.toHaveBeenCalled();
    });

    it('should NOT call saveCandidate or initialize call status for unsupported attachment format', async () => {
      mockSheetsClient.spreadsheets.values.append.mockClear();
      mockSheetsClient.spreadsheets.values.update.mockClear();
      (candidateExcelService.saveCandidate as jest.Mock).mockClear();

      const mockDetail: any = {
        id: 'msg-screen-invalid-ext',
        sender: { email: 'test@example.com', name: 'Test' },
        subject: 'Application',
        attachments: [{ attachmentId: 'att-jpg-1', filename: 'photo.jpg' }],
      };

      const mockResult: any = {
        status: 'success',
        attachmentId: 'att-jpg-1',
        filename: 'photo.jpg',
        analysis: {
          candidate: { name: 'Test', email: 'test@example.com' },
          application: { jobRole: 'HR Intern' },
          screeningStatus: 'REJECT',
        },
      };

      const result = await candidateService.persistAndProcessScreeningResult({
        messageDetail: mockDetail,
        analysisResult: mockResult,
      });

      expect(result).toBeNull();
      expect(candidateExcelService.saveCandidate).not.toHaveBeenCalled();
      expect(
        mockSheetsClient.spreadsheets.values.append,
      ).not.toHaveBeenCalled();
    });

    it('should NOT create duplicate candidate rows when the same resume is reprocessed', async () => {
      // Simulate candidate already cached in Redis as processed
      const idempotencyKey = 'msg-dup-check:att-dup-1';
      redisStore.set(
        `recruitment:candidate:processed:${idempotencyKey}`,
        '101',
      );

      // Mock getCandidateById returning existing candidate
      jest
        .spyOn(candidateExcelService, 'getCandidateById')
        .mockResolvedValueOnce({
          id: 101,
          name: 'Deepak Rao',
          email: 'deepak@example.com',
        } as any);

      const mockDetail: any = {
        id: 'msg-dup-check',
        sender: { email: 'deepak@example.com', name: 'Deepak Rao' },
        subject: 'Application for HR Intern',
        attachments: [
          { attachmentId: 'att-dup-1', filename: 'deepak_resume.pdf' },
        ],
      };

      const mockAnalysisResult: any = {
        status: 'success',
        attachmentId: 'att-dup-1',
        filename: 'deepak_resume.pdf',
        analysis: {
          candidate: { name: 'Deepak Rao', email: 'deepak@example.com' },
          application: { jobRole: 'HR Intern' },
          screeningStatus: 'SHORTLIST',
          matchScore: 88,
        },
      };

      mockSheetsClient.spreadsheets.values.append.mockClear();

      const res = await candidateService.persistAndProcessScreeningResult({
        messageDetail: mockDetail,
        analysisResult: mockAnalysisResult,
      });

      expect(res.id).toBe(101);
      // Verify no duplicate append was issued
      expect(
        mockSheetsClient.spreadsheets.values.append,
      ).not.toHaveBeenCalled();
    });
  });
});
