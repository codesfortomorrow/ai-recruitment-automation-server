import { google } from 'googleapis';
import { GoogleSheetsService } from './google-sheets.service';

describe('CV Link (AA) and Drive File ID (AB) Persistence & Backfill Suite', () => {
  let googleSheetsService: GoogleSheetsService;
  let mockSheetsClient: any;
  let mockRedisClient: any;

  beforeEach(() => {
    mockRedisClient = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      exists: jest.fn().mockResolvedValue(0),
      incr: jest.fn().mockResolvedValue(100),
    };

    mockSheetsClient = {
      spreadsheets: {
        get: jest.fn().mockResolvedValue({
          data: {
            sheets: [
              {
                properties: {
                  title: 'Candidate Tracker',
                  sheetId: 0,
                  gridProperties: { rowCount: 100, columnCount: 28 },
                },
              },
            ],
          },
        }),
        values: {
          get: jest.fn().mockResolvedValue({
            data: { values: [GoogleSheetsService.EXPECTED_HEADERS] },
          }),
          update: jest.fn().mockResolvedValue({
            data: { updatedRange: "'Candidate Tracker'!A2:AB2" },
          }),
          append: jest.fn().mockResolvedValue({
            data: {
              updates: { updatedRange: "'Candidate Tracker'!A3:AB3" },
            },
          }),
        },
        batchUpdate: jest.fn().mockResolvedValue({ data: {} }),
      },
    };

    jest.spyOn(google, 'sheets').mockReturnValue(mockSheetsClient as any);

    googleSheetsService = new GoogleSheetsService(
      {
        spreadsheetId: 'test-spreadsheet-id',
        tabName: 'Candidate Tracker',
        keyFile: './config/google-service-account.json',
        syncIntervalSeconds: 60,
      } as any,
      { client: mockRedisClient } as any,
    );

    jest
      .spyOn(googleSheetsService, 'getClient')
      .mockReturnValue(mockSheetsClient as any);
  });

  describe('1. AA and AB Column Mapping & Formula Input Option', () => {
    it('should write clickable CV Link in AA (col 26) and Drive File ID in AB (col 27) with USER_ENTERED on append', async () => {
      mockSheetsClient.spreadsheets.values.get.mockResolvedValueOnce({
        data: { values: [GoogleSheetsService.EXPECTED_HEADERS] },
      });

      const result = await googleSheetsService.saveCandidate({
        id: 101,
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+91 9876543210',
        jobRole: 'React.js Developer',
        driveFileId: 'drive-file-abc-123',
        cvLink:
          '=HYPERLINK("https://drive.google.com/file/d/drive-file-abc-123/view", "View CV")',
      });

      expect(result.action).toBe('appended');
      expect(mockSheetsClient.spreadsheets.values.append).toHaveBeenCalledTimes(
        1,
      );

      const appendCall =
        mockSheetsClient.spreadsheets.values.append.mock.calls[0][0];
      expect(appendCall.range).toBe("'Candidate Tracker'!A:AB");
      expect(appendCall.valueInputOption).toBe('USER_ENTERED');

      const rowValues = appendCall.requestBody.values[0];
      expect(rowValues.length).toBe(28);
      expect(rowValues[0]).toBe(101); // Col A
      expect(rowValues[26]).toBe(
        '=HYPERLINK("https://drive.google.com/file/d/drive-file-abc-123/view", "View CV")',
      ); // Col AA
      expect(rowValues[27]).toBe('drive-file-abc-123'); // Col AB
    });

    it('should synthesize HYPERLINK formula automatically if driveFileId is provided without cvLink', async () => {
      mockSheetsClient.spreadsheets.values.get.mockResolvedValueOnce({
        data: { values: [GoogleSheetsService.EXPECTED_HEADERS] },
      });

      await googleSheetsService.saveCandidate({
        id: 102,
        name: 'John Smith',
        email: 'john@example.com',
        driveFileId: 'drive-file-xyz-789',
      });

      const appendCall =
        mockSheetsClient.spreadsheets.values.append.mock.calls[0][0];
      expect(appendCall.valueInputOption).toBe('USER_ENTERED');
      const rowValues = appendCall.requestBody.values[0];
      expect(rowValues[26]).toBe(
        '=HYPERLINK("https://drive.google.com/file/d/drive-file-xyz-789/view", "View CV")',
      );
      expect(rowValues[27]).toBe('drive-file-xyz-789');
    });

    it('should update legacy 26-column row to 28 columns (A:AB) without truncating to Z', async () => {
      // Existing 26-column row (no AA or AB columns yet)
      const legacy26Row = new Array(26).fill('');
      legacy26Row[0] = '103';
      legacy26Row[1] = 'Legacy Candidate';
      legacy26Row[2] = 'legacy@example.com';
      legacy26Row[11] = '2026-10-15'; // 1st Call Date (HR field)
      legacy26Row[12] = 'Connected'; // 1st Call Status (HR field)
      legacy26Row[13] = 'Spoke with candidate'; // 1st Call Remarks (HR field)

      mockSheetsClient.spreadsheets.values.get.mockResolvedValueOnce({
        data: { values: [GoogleSheetsService.EXPECTED_HEADERS, legacy26Row] },
      });

      const result = await googleSheetsService.saveCandidate({
        id: 103,
        name: 'Legacy Candidate',
        email: 'legacy@example.com',
        driveFileId: 'drive-file-legacy-456',
        cvLink:
          '=HYPERLINK("https://drive.google.com/file/d/drive-file-legacy-456/view", "View CV")',
      });

      expect(result.action).toBe('updated');
      expect(mockSheetsClient.spreadsheets.values.update).toHaveBeenCalledTimes(
        1,
      );

      const updateCall =
        mockSheetsClient.spreadsheets.values.update.mock.calls[0][0];
      expect(updateCall.range).toBe("'Candidate Tracker'!A2:AB2");
      expect(updateCall.valueInputOption).toBe('USER_ENTERED');

      const updatedValues = updateCall.requestBody.values[0];
      expect(updatedValues.length).toBe(28);
      // Preserves HR-managed fields
      expect(updatedValues[11]).toBe('2026-10-15');
      expect(updatedValues[12]).toBe('Connected');
      expect(updatedValues[13]).toBe('Spoke with candidate');
      // Updates AA and AB
      expect(updatedValues[26]).toBe(
        '=HYPERLINK("https://drive.google.com/file/d/drive-file-legacy-456/view", "View CV")',
      );
      expect(updatedValues[27]).toBe('drive-file-legacy-456');
    });

    it('should preserve existing AA and AB values during subsequent updates when not explicitly passed', async () => {
      const existing28Row = new Array(28).fill('');
      existing28Row[0] = '104';
      existing28Row[1] = 'Bob Builder';
      existing28Row[2] = 'bob@example.com';
      existing28Row[26] =
        '=HYPERLINK("https://drive.google.com/file/d/bob-file-id/view", "View CV")';
      existing28Row[27] = 'bob-file-id';

      mockSheetsClient.spreadsheets.values.get.mockResolvedValueOnce({
        data: { values: [GoogleSheetsService.EXPECTED_HEADERS, existing28Row] },
      });

      // Subsequent update without passing cvLink or driveFileId (e.g. HR call update)
      await googleSheetsService.saveCandidate({
        id: 104,
        call1Date: '2026-10-21',
        call1Status: 'Busy',
      });

      const updateCall =
        mockSheetsClient.spreadsheets.values.update.mock.calls[0][0];
      const updatedValues = updateCall.requestBody.values[0];
      expect(updatedValues[26]).toBe(
        '=HYPERLINK("https://drive.google.com/file/d/bob-file-id/view", "View CV")',
      );
      expect(updatedValues[27]).toBe('bob-file-id');
      expect(updatedValues[11]).toBe('2026-10-21');
      expect(updatedValues[12]).toBe('Busy');
    });
  });

  describe('2. Safe Idempotent Backfill Logic', () => {
    it('should match candidates by email and populate AA and AB without overwriting columns A:Z', async () => {
      const row1 = new Array(26).fill('');
      row1[0] = '1';
      row1[1] = 'Alice Developer';
      row1[2] = 'alice@example.com';
      row1[4] = 'React.js Developer';
      row1[12] = 'Shortlisted';

      const row2 = new Array(26).fill('');
      row2[0] = '2';
      row2[1] = 'Charlie Node';
      row2[2] = 'charlie@example.com';
      row2[4] = 'Node.js Developer';

      const row3 = new Array(26).fill('');
      row3[0] = '3';
      row3[1] = 'Unknown Candidate';
      row3[2] = 'unknown@example.com';

      const driveFiles = [
        {
          id: 'drive-alice-111',
          name: 'Candidate_1_Alice_Resume.pdf',
          candidateEmail: 'alice@example.com',
        },
        {
          id: 'drive-charlie-222',
          name: 'Charlie_CV_Node.pdf',
          candidateEmail: 'charlie@example.com',
        },
      ];

      const trackerRows = [
        { rowIndex: 2, candidateId: 1, email: 'alice@example.com', row: row1 },
        {
          rowIndex: 3,
          candidateId: 2,
          email: 'charlie@example.com',
          row: row2,
        },
        {
          rowIndex: 4,
          candidateId: 3,
          email: 'unknown@example.com',
          row: row3,
        },
      ];

      const backfillActions: Array<{
        rowIndex: number;
        candidateId: number;
        fileId?: string;
        action: 'MATCHED' | 'MANUAL_REVIEW';
      }> = [];

      for (const candidate of trackerRows) {
        const match = driveFiles.find(
          (f) =>
            f.candidateEmail.toLowerCase() === candidate.email.toLowerCase() ||
            f.name
              .toLowerCase()
              .includes(`candidate_${candidate.candidateId}_`),
        );

        if (match) {
          backfillActions.push({
            rowIndex: candidate.rowIndex,
            candidateId: candidate.candidateId,
            fileId: match.id,
            action: 'MATCHED',
          });
        } else {
          backfillActions.push({
            rowIndex: candidate.rowIndex,
            candidateId: candidate.candidateId,
            action: 'MANUAL_REVIEW',
          });
        }
      }

      expect(backfillActions).toEqual([
        {
          rowIndex: 2,
          candidateId: 1,
          fileId: 'drive-alice-111',
          action: 'MATCHED',
        },
        {
          rowIndex: 3,
          candidateId: 2,
          fileId: 'drive-charlie-222',
          action: 'MATCHED',
        },
        { rowIndex: 4, candidateId: 3, action: 'MANUAL_REVIEW' },
      ]);
    });

    it('should update only AA and AB via updateCandidateDriveColumns with USER_ENTERED', async () => {
      const res = await googleSheetsService.updateCandidateDriveColumns(
        5,
        'drive-file-direct-999',
        'https://drive.google.com/file/d/drive-file-direct-999/view',
      );

      expect(res.rowNumber).toBe(5);
      expect(res.driveFileId).toBe('drive-file-direct-999');
      expect(res.cvLink).toBe(
        '=HYPERLINK("https://drive.google.com/file/d/drive-file-direct-999/view", "View CV")',
      );

      expect(mockSheetsClient.spreadsheets.values.update).toHaveBeenCalledTimes(
        1,
      );
      const updateCall =
        mockSheetsClient.spreadsheets.values.update.mock.calls[0][0];
      expect(updateCall.range).toBe("'Candidate Tracker'!AA5:AB5");
      expect(updateCall.valueInputOption).toBe('USER_ENTERED');
      expect(updateCall.requestBody.values[0]).toEqual([
        '=HYPERLINK("https://drive.google.com/file/d/drive-file-direct-999/view", "View CV")',
        'drive-file-direct-999',
      ]);
    });

    it('should convert raw URL into HYPERLINK formula in saveCandidate', async () => {
      mockSheetsClient.spreadsheets.values.get.mockResolvedValueOnce({
        data: { values: [GoogleSheetsService.EXPECTED_HEADERS] },
      });

      await googleSheetsService.saveCandidate({
        id: 105,
        name: 'Eva Green',
        email: 'eva@example.com',
        driveFileId: 'drive-file-eva-123',
        cvLink: 'https://drive.google.com/file/d/drive-file-eva-123/view',
      });

      const appendCall =
        mockSheetsClient.spreadsheets.values.append.mock.calls[0][0];
      expect(appendCall.valueInputOption).toBe('USER_ENTERED');
      const rowValues = appendCall.requestBody.values[0];
      expect(rowValues[26]).toBe(
        '=HYPERLINK("https://drive.google.com/file/d/drive-file-eva-123/view", "View CV")',
      );
      expect(rowValues[27]).toBe('drive-file-eva-123');
    });
  });
});
