import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { google, sheets_v4 } from 'googleapis';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { BaseService } from '@Common';
import { googleSheetsConfigFactory } from '@Config';
import { RedisService } from '../redis';

export interface GoogleSheetCandidateInput {
  id?: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  jobRole?: string | null;
  assignedHrName?: string | null;
  experience?: any;
  company?: string | null;
  screeningStatus?: string | null;
  applicationStatus?: string | null;
  rejectionReason?: string | null;
  hrRemarks?: string | null;
  currentInterviewRound?: string | null;
  callCount?: number | null;
  totalCallAttempts?: number | null;
  call1Date?: string | null;
  call1Status?: string | null;
  call1Remarks?: string | null;
  call2Date?: string | null;
  call2Status?: string | null;
  call2Remarks?: string | null;
  call3Date?: string | null;
  call3Status?: string | null;
  call3Remarks?: string | null;
  lastCallStatus?: string | null;
  lastContactDate?: string | null;
  nextFollowUpDate?: string | null;
  call1DateAndStatus?: string | null;
  call2DateAndStatus?: string | null;
  call3DateAndStatus?: string | null;
  lastCallDate?: string | null;
  automatedFollowUpEmailStatus?: string | null;
  followUpEmailSentAt?: string | null;
  cvLink?: string | null;
  driveFileId?: string | null;
}

export interface GoogleSheetSaveResult {
  action: 'appended' | 'updated';
  candidateId: number;
  rowNumber: number;
  updatedRange?: string;
}

export interface GoogleSheetTrackerRow {
  rowIndex: number;
  candidateId: number;
  candidateName: string;
  email: string;
  phone: string;
  jobRole: string;
  assignedHrName: string;
  totalExperience: string;
  currentCompany: string;
  applicationStatus: string;
  currentInterviewRound: string;
  totalCallAttempts: number;
  call1Date: string;
  call1Status: string;
  call1Remarks: string;
  call2Date: string;
  call2Status: string;
  call2Remarks: string;
  call3Date: string;
  call3Status: string;
  call3Remarks: string;
  nextFollowUpDate: string;
  automatedFollowUpEmailStatus: string;
  followUpEmailSentAt: string;
  hrRemarks: string;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
  cvLink?: string;
  driveFileId?: string;
}

@Injectable()
export class GoogleSheetsService extends BaseService implements OnModuleInit {
  private sheets: sheets_v4.Sheets | null = null;
  private static readonly REDIS_LOCK_KEY = 'lock:google-sheets-persistence';
  private static readonly REDIS_LOCK_TTL_SECONDS = 60;
  private static readonly MAX_RETRIES = 3;

  public static readonly EXPECTED_HEADERS = [
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
    '1st Call Date',
    '1st Call Status',
    '1st Call Remarks',
    '2nd Call Date',
    '2nd Call Status',
    '2nd Call Remarks',
    '3rd Call Date',
    '3rd Call Status',
    '3rd Call Remarks',
    'Next Follow-up Date',
    'Automated Follow-up Email Status',
    'Follow-up Email Sent At',
    'HR Remarks',
    'Last Updated By',
    'Last Updated At',
    'CV Link',
    'Drive File ID',
  ];

  public static readonly APPLICATION_STATUS_OPTIONS = [
    'New',
    'Shortlisted',
    'On Hold',
    'Rejected',
    'Selected',
  ];

  public static readonly INTERVIEW_ROUND_OPTIONS = [
    'Not Started',
    'HR Round',
    'Technical Round 1',
    'Technical Round 2',
    'Managerial Round',
    'Final Round',
    'Completed',
  ];

  public static readonly CALL_STATUS_OPTIONS = [
    'Not Answered',
    'Answered',
    'Busy',
    'Call Back Requested',
    'Invalid Number',
    'Switched Off',
  ];

  public static readonly LAST_CALL_STATUS_OPTIONS = [
    'Not Called',
    'Answered',
    'Not Answered',
    'Busy',
    'Call Back Requested',
    'Invalid Number',
    'Switched Off',
  ];

  public static readonly FOLLOW_UP_EMAIL_STATUS_OPTIONS = [
    'NOT_SENT',
    'SENT',
    'FAILED_INVALID_EMAIL',
    'SKIPPED_REPLIED',
    'NOT_REQUIRED',
  ];

  constructor(
    @Inject(googleSheetsConfigFactory.KEY)
    private readonly config: ConfigType<typeof googleSheetsConfigFactory>,
    private readonly redisService: RedisService,
  ) {
    super({
      loggerDefaultMeta: { service: GoogleSheetsService.name },
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.isConfigured()) {
      try {
        await this.ensureCandidateTrackerSheet();
      } catch (err: any) {
        this.logger.error(
          `Failed to ensure Google Sheets Candidate Tracker on startup: ${this.sanitizeError(err)}`,
        );
      }
    } else if (this.isRequired()) {
      const issue = this.getConfigurationIssue();
      this.logger.warn(
        `Google Sheets candidate synchronization is required but misconfigured: ${issue}. Newly processed candidates will be queued for retry until resolved.`,
        {
          spreadsheetId: this.config.spreadsheetId,
          tabName: this.config.tabName,
        },
      );
    }
  }

  /**
   * Returns whether Google Sheets configuration is required by environment settings.
   */
  public isRequired(): boolean {
    return Boolean(
      this.config.spreadsheetId && this.config.spreadsheetId.trim().length > 0,
    );
  }

  /**
   * Returns the exact configuration issue if Google Sheets is missing or misconfigured,
   * without exposing private credentials, tokens, or secrets.
   */
  public getConfigurationIssue(): string {
    if (!this.config.spreadsheetId || !this.config.spreadsheetId.trim()) {
      return 'GOOGLE_SHEETS_SPREADSHEET_ID is missing or empty in environment';
    }
    if (!this.config.keyFile || !this.config.keyFile.trim()) {
      return 'GOOGLE_SHEETS_KEY_FILE is missing or empty in environment';
    }
    const resolvedKeyPath = path.isAbsolute(this.config.keyFile)
      ? this.config.keyFile
      : path.resolve(process.cwd(), this.config.keyFile);
    if (!fs.existsSync(resolvedKeyPath)) {
      return `Google Service Account key file not found at path "${resolvedKeyPath}". Please ensure the service account JSON key file exists at this path or configure GOOGLE_SHEETS_KEY_FILE`;
    }
    try {
      const stats = fs.statSync(resolvedKeyPath);
      if (!stats.isFile()) {
        return `Path "${resolvedKeyPath}" is a directory, not a valid service account JSON file`;
      }
      fs.accessSync(resolvedKeyPath, fs.constants.R_OK);
      const raw = fs.readFileSync(resolvedKeyPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (
        parsed.type !== 'service_account' ||
        !parsed.project_id ||
        !parsed.private_key ||
        !parsed.client_email
      ) {
        return `Service account JSON file at "${resolvedKeyPath}" is missing required fields (type, project_id, private_key, or client_email)`;
      }
    } catch (parseErr: any) {
      return `Failed to read or parse service account JSON file at "${resolvedKeyPath}": ${parseErr.message}`;
    }
    return '';
  }

  public getSpreadsheetId(): string {
    return this.config.spreadsheetId || '';
  }

  /**
   * Returns whether Google Sheets configuration is present and valid.
   */
  public isConfigured(): boolean {
    return this.getConfigurationIssue() === '';
  }

  public getPollingConfig(): {
    pollingEnabled: boolean;
    pollingIntervalMinutes: number;
  } {
    return {
      pollingEnabled: this.config.pollingEnabled !== false,
      pollingIntervalMinutes: this.config.pollingIntervalMinutes || 2,
    };
  }

  /**
   * Computes a deterministic SHA256 hash of call-tracking and HR-managed fields
   * to detect genuine HR changes and prevent synchronization loops.
   */
  public computeCallTrackingHash(row: {
    applicationStatus?: string | null;
    currentInterviewRound?: string | null;
    call1Date?: string | null;
    call1Status?: string | null;
    call1Remarks?: string | null;
    call2Date?: string | null;
    call2Status?: string | null;
    call2Remarks?: string | null;
    call3Date?: string | null;
    call3Status?: string | null;
    call3Remarks?: string | null;
    nextFollowUpDate?: string | null;
    hrRemarks?: string | null;
  }): string {
    const norm = (val?: string | null) =>
      val ? String(val).trim().toLowerCase() : '';
    const payload = [
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
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Records the last synchronized call-tracking hash for a candidate in Redis.
   */
  public async recordSyncedHash(
    candidateId: number,
    hash: string,
  ): Promise<void> {
    if (
      !this.redisService?.client ||
      candidateId === undefined ||
      candidateId === null
    ) {
      return;
    }
    try {
      await this.redisService.client.set(
        `recruitment:google-sheets:last-synced-hash:${candidateId}`,
        hash,
        'EX',
        86400 * 30,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to cache synced hash in Redis for candidate ${candidateId}`,
        { error: this.sanitizeError(err) },
      );
    }
  }

  /**
   * Retrieves the last synchronized call-tracking hash for a candidate from Redis.
   */
  public async getSyncedHash(candidateId: number): Promise<string | null> {
    if (
      !this.redisService?.client ||
      candidateId === undefined ||
      candidateId === null
    ) {
      return null;
    }
    try {
      return await this.redisService.client.get(
        `recruitment:google-sheets:last-synced-hash:${candidateId}`,
      );
    } catch {
      return null;
    }
  }

  /**
   * Sanitizes and formats candidate phone numbers for Google Sheets and backend persistence:
   * - Strips any leading apostrophes used as escaping prefixes (e.g. `' +91...` or `'+91...`)
   * - Cleans corrupted Google Sheets formula errors (e.g. `#ERROR!`, `#VALUE!`, `#REF!`, `#NAME?`, `#N/A`)
   * - Treats all mobile numbers as strings (never as mathematical numbers or formulas)
   * - Preserves leading `+`, country code, spaces, parentheses, hyphens, and leading zeros
   */
  public formatPhoneNumberForSheet(rawPhone: any): string {
    if (rawPhone === undefined || rawPhone === null) {
      return '';
    }
    let phoneStr = String(rawPhone).trim();
    if (!phoneStr) {
      return '';
    }
    // Clean formula error tokens that might have been stored in legacy sheets
    if (
      phoneStr === '#ERROR!' ||
      phoneStr === '#VALUE!' ||
      phoneStr === '#REF!' ||
      phoneStr === '#NAME?' ||
      phoneStr === '#N/A'
    ) {
      return '';
    }
    // Strip leading apostrophe if present so neither the backend nor the sheet has unnecessary apostrophes
    if (
      phoneStr.startsWith("'") ||
      phoneStr.startsWith('’') ||
      phoneStr.startsWith('`')
    ) {
      phoneStr = phoneStr.substring(1).trim();
    }
    return phoneStr;
  }

  /**
   * Reads all candidate rows from the configured Google Sheet tracker tab.
   * Maps canonical A:Z columns and filters out non-candidate rows.
   */
  public async readCandidateTrackerRows(): Promise<GoogleSheetTrackerRow[]> {
    const client = this.getClient();
    if (!client) {
      throw new Error(
        'Google Sheets service is not configured or failed to initialize',
      );
    }

    return this.executeWithRetry(async () => {
      const tabName = this.config.tabName || 'Candidate Tracker';
      const spreadsheetId = this.config.spreadsheetId;

      const readRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tabName}'!A:AB`,
      });

      const rows: any[][] = readRes.data.values || [];
      if (rows.length <= 1) {
        return [];
      }

      const trackerRows: GoogleSheetTrackerRow[] = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const rawId = String(row[0] || '').trim();
        if (!rawId) continue;
        const candidateId = parseInt(rawId, 10);
        if (isNaN(candidateId)) continue;

        trackerRows.push({
          rowIndex: r + 1,
          candidateId,
          candidateName: String(row[1] || '').trim(),
          email: String(row[2] || '').trim(),
          phone: this.formatPhoneNumberForSheet(row[3]),
          jobRole: String(row[4] || '').trim(),
          assignedHrName: String(row[5] || '').trim(),
          totalExperience: String(row[6] || '').trim(),
          currentCompany: String(row[7] || '').trim(),
          applicationStatus: String(row[8] || '').trim(),
          currentInterviewRound: String(row[9] || '').trim(),
          totalCallAttempts: parseInt(String(row[10] || '').trim(), 10) || 0,
          call1Date: String(row[11] || '').trim(),
          call1Status: String(row[12] || '').trim(),
          call1Remarks: String(row[13] || '').trim(),
          call2Date: String(row[14] || '').trim(),
          call2Status: String(row[15] || '').trim(),
          call2Remarks: String(row[16] || '').trim(),
          call3Date: String(row[17] || '').trim(),
          call3Status: String(row[18] || '').trim(),
          call3Remarks: String(row[19] || '').trim(),
          nextFollowUpDate: String(row[20] || '').trim(),
          automatedFollowUpEmailStatus: String(row[21] || '').trim(),
          followUpEmailSentAt: String(row[22] || '').trim(),
          hrRemarks: String(row[23] || '').trim(),
          lastUpdatedBy: String(row[24] || '').trim(),
          lastUpdatedAt: String(row[25] || '').trim(),
          cvLink: String(row[26] || '').trim(),
          driveFileId: String(row[27] || '').trim(),
        });
      }

      return trackerRows;
    });
  }

  /**
   * Retrieves single candidate row by Candidate ID from Google Sheets tracker tab.
   */
  public async findCandidateById(
    candidateId: number,
  ): Promise<GoogleSheetTrackerRow | null> {
    if (
      !this.isConfigured() ||
      candidateId === undefined ||
      candidateId === null ||
      isNaN(candidateId)
    ) {
      return null;
    }
    const rows = await this.readCandidateTrackerRows();
    return rows.find((r) => r.candidateId === candidateId) || null;
  }

  /**
   * Retrieves single candidate row by normalized email from Google Sheets tracker tab.
   */
  public async findCandidateByEmail(
    email: string,
  ): Promise<GoogleSheetTrackerRow | null> {
    if (!this.isConfigured() || !email) {
      return null;
    }
    const normalized = email.trim().toLowerCase();
    const rows = await this.readCandidateTrackerRows();
    return (
      rows.find(
        (r) => r.email && r.email.trim().toLowerCase() === normalized,
      ) || null
    );
  }

  /**
   * Updates only the automated follow-up email status columns (V and W)
   * and audit columns (Y and Z) for a candidate row in Google Sheets.
   */
  public async updateFollowUpEmailStatusInSheet(
    candidateId: number,
    status: string,
    sentAt: string,
  ): Promise<boolean> {
    const client = this.getClient();
    if (!client) {
      return false;
    }

    return this.executeWithLock(async () => {
      const tabName = this.config.tabName || 'Candidate Tracker';
      const spreadsheetId = this.config.spreadsheetId;

      const readRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tabName}'!A:AB`,
      });

      const rows: any[][] = readRes.data.values || [];
      let targetRowIndex = -1;
      for (let r = 1; r < rows.length; r++) {
        const cellId = parseInt(String(rows[r]?.[0] || '').trim(), 10);
        if (!isNaN(cellId) && cellId === candidateId) {
          targetRowIndex = r;
          break;
        }
      }

      if (targetRowIndex === -1) {
        return false;
      }

      const rowNumber = targetRowIndex + 1;
      const existingRow = rows[targetRowIndex] || [];
      const nowFormatted = this.formatLastUpdatedAt();
      const formattedSentAt = this.formatHumanReadableDate(sentAt);

      await client.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!V${rowNumber}:W${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[status, formattedSentAt]],
        },
      });

      await client.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!Y${rowNumber}:Z${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['AI Recruitment System', nowFormatted]],
        },
      });

      const updatedRow = [...existingRow];
      updatedRow[21] = status;
      updatedRow[22] = formattedSentAt;
      updatedRow[24] = 'AI Recruitment System';
      updatedRow[25] = nowFormatted;

      const newHash = this.computeCallTrackingHash({
        applicationStatus: updatedRow[8],
        currentInterviewRound: updatedRow[9],
        call1Date: updatedRow[11],
        call1Status: updatedRow[12],
        call1Remarks: updatedRow[13],
        call2Date: updatedRow[14],
        call2Status: updatedRow[15],
        call2Remarks: updatedRow[16],
        call3Date: updatedRow[17],
        call3Status: updatedRow[18],
        call3Remarks: updatedRow[19],
        nextFollowUpDate: updatedRow[20],
        hrRemarks: updatedRow[23],
      });
      await this.recordSyncedHash(candidateId, newHash);
      return true;
    });
  }

  /**
   * Initializes or returns the cached Google Sheets API client.
   */
  public getClient(): sheets_v4.Sheets | null {
    if (this.sheets) {
      return this.sheets;
    }

    if (!this.config.spreadsheetId) {
      this.logger.warn(
        'GOOGLE_SHEETS_SPREADSHEET_ID is not configured; Google Sheets sync will be unavailable',
      );
      return null;
    }

    const resolvedKeyPath = path.isAbsolute(this.config.keyFile)
      ? this.config.keyFile
      : path.resolve(process.cwd(), this.config.keyFile);

    if (!fs.existsSync(resolvedKeyPath)) {
      this.logger.warn(
        `Google Service Account key file not found at ${resolvedKeyPath}; Google Sheets sync will be unavailable`,
      );
      return null;
    }

    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: resolvedKeyPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      this.sheets = google.sheets({ version: 'v4', auth });
      this.logger.info('GoogleSheetsService initialized successfully', {
        spreadsheetId: this.config.spreadsheetId,
        tabName: this.config.tabName,
        keyFile: resolvedKeyPath,
      });
      return this.sheets;
    } catch (err: any) {
      this.logger.error('Failed to initialize Google Sheets client', {
        cause: this.sanitizeError(err),
      });
      return null;
    }
  }

  /**
   * Explicitly ensures the Candidate Tracker worksheet exists, has canonical 26-column A:Z headers,
   * and migrates any outdated schema (e.g. 17-column layout) safely without data loss or column shifting.
   * This method is idempotent and safe to run on startup or on demand.
   */
  public async ensureCandidateTrackerSheet(): Promise<{
    status: 'up-to-date' | 'migrated' | 'created';
    tabName: string;
    oldHeaderCount: number;
    newHeaderCount: number;
    candidateRowsCount: number;
    headers: string[];
  }> {
    const client = this.getClient();
    if (!client) {
      this.logger.warn(
        'Google Sheets service is not configured; skipping ensureCandidateTrackerSheet',
      );
      return {
        status: 'up-to-date',
        tabName: this.config.tabName || 'Candidate Tracker',
        oldHeaderCount: 0,
        newHeaderCount: GoogleSheetsService.EXPECTED_HEADERS.length,
        candidateRowsCount: 0,
        headers: GoogleSheetsService.EXPECTED_HEADERS,
      };
    }

    return this.executeWithLock(async () => {
      const tabName = this.config.tabName || 'Candidate Tracker';
      const spreadsheetId = this.config.spreadsheetId;

      // 1. Fetch worksheet metadata
      const spreadsheetMeta = await client.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title,gridProperties))',
      });

      const targetSheet = spreadsheetMeta.data.sheets?.find(
        (s) => s.properties?.title?.toLowerCase() === tabName.toLowerCase(),
      );

      // If sheet doesn't exist, create it
      if (!targetSheet) {
        const addSheetRes = await client.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: tabName,
                    gridProperties: {
                      rowCount: 1000,
                      columnCount: GoogleSheetsService.EXPECTED_HEADERS.length,
                    },
                  },
                },
              },
            ],
          },
        });
        const createdSheetId =
          addSheetRes.data.replies?.[0]?.addSheet?.properties?.sheetId || 0;
        await client.spreadsheets.values.update({
          spreadsheetId,
          range: `'${tabName}'!A1:AB1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [GoogleSheetsService.EXPECTED_HEADERS],
          },
        });
        await this.ensureHeaderRowFormatting(
          client,
          spreadsheetId,
          createdSheetId,
        );

        this.logger.info(
          `Created Google Sheets worksheet "${tabName}" with canonical 28-column A:AB schema`,
          {
            worksheet: tabName,
            detectedOldSchema: [],
            newSchema: GoogleSheetsService.EXPECTED_HEADERS,
            migrationResult: 'CREATED',
          },
        );

        return {
          status: 'created',
          tabName,
          oldHeaderCount: 0,
          newHeaderCount: GoogleSheetsService.EXPECTED_HEADERS.length,
          candidateRowsCount: 0,
          headers: GoogleSheetsService.EXPECTED_HEADERS,
        };
      }

      const sheetId = targetSheet.properties?.sheetId ?? 0;
      const actualTabName = targetSheet.properties?.title || tabName;
      const rowCount = targetSheet.properties?.gridProperties?.rowCount ?? 1000;
      const colCount =
        targetSheet.properties?.gridProperties?.columnCount ?? 26;

      // Ensure gridProperties has at least 28 columns (A:AB)
      if (colCount < GoogleSheetsService.EXPECTED_HEADERS.length) {
        await client.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId,
                    gridProperties: {
                      columnCount: GoogleSheetsService.EXPECTED_HEADERS.length,
                    },
                  },
                  fields: 'gridProperties.columnCount',
                },
              },
            ],
          },
        });
      }

      // Read current rows
      const readRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${actualTabName}'!A:AB`,
      });
      const rows: any[][] = readRes.data.values || [];

      const existingHeaders = rows[0] || [];
      const isUpToDate =
        existingHeaders.length ===
          GoogleSheetsService.EXPECTED_HEADERS.length &&
        existingHeaders.every(
          (h, idx) =>
            String(h || '')
              .trim()
              .toLowerCase() ===
            GoogleSheetsService.EXPECTED_HEADERS[idx].toLowerCase(),
        );

      if (isUpToDate) {
        // Clean up any empty/orphaned rows below real candidates that have no candidate ID
        let lastCandidateRow = 1;
        for (let r = 1; r < rows.length; r++) {
          const candidateId = rows[r]?.[0];
          if (candidateId && String(candidateId).trim() !== '') {
            lastCandidateRow = r + 1;
          }
        }
        if (rows.length > lastCandidateRow) {
          try {
            await client.spreadsheets.values.clear({
              spreadsheetId,
              range: `'${actualTabName}'!A${lastCandidateRow + 1}:AB${Math.max(rowCount, rows.length)}`,
            });
          } catch (clearErr: any) {
            this.logger.warn(
              `Failed to clear orphaned rows: ${this.sanitizeError(clearErr)}`,
            );
          }
        }

        // Apply clean column validations and date formatting across all rows
        await this.ensureSheetColumnValidationsAndFormatting(
          client,
          spreadsheetId,
          sheetId,
          Math.max(rowCount, 1000),
        );

        this.logger.info(
          `Google Sheets Candidate Tracker schema is already up to date with 28-column A:AB schema`,
          {
            worksheet: actualTabName,
            detectedOldSchema: existingHeaders,
            newSchema: GoogleSheetsService.EXPECTED_HEADERS,
            migrationResult: 'ALREADY_UP_TO_DATE',
            candidateCount: Math.max(0, lastCandidateRow - 1),
          },
        );
        return {
          status: 'up-to-date',
          tabName: actualTabName,
          oldHeaderCount: existingHeaders.length,
          newHeaderCount: GoogleSheetsService.EXPECTED_HEADERS.length,
          candidateRowsCount: Math.max(0, lastCandidateRow - 1),
          headers: existingHeaders,
        };
      }

      // Run migration
      const migratedRows = await this.migrateSheetSchemaIfOutdated(
        client,
        spreadsheetId,
        sheetId,
        actualTabName,
        rows,
      );

      return {
        status: 'migrated',
        tabName: actualTabName,
        oldHeaderCount: existingHeaders.length,
        newHeaderCount: GoogleSheetsService.EXPECTED_HEADERS.length,
        candidateRowsCount: Math.max(0, migratedRows.length - 1),
        headers: GoogleSheetsService.EXPECTED_HEADERS,
      };
    });
  }

  /**
   * For testing purposes, allows setting a mock Sheets client.
   */
  public setMockSheetsClient(mockSheets: sheets_v4.Sheets | any): void {
    this.sheets = mockSheets;
  }

  /**
   * Saves or updates a candidate record directly in Google Sheets.
   * Maps fields to the exact 17 columns in order.
   * Preserves existing HR-managed fields during updates.
   */
  public async saveCandidate(
    input: GoogleSheetCandidateInput,
  ): Promise<GoogleSheetSaveResult> {
    const client = this.getClient();
    if (!client) {
      throw new Error(
        'Google Sheets service is not configured or failed to initialize',
      );
    }

    return this.executeWithLock(async () => {
      const tabName = this.config.tabName || 'Candidate Tracker';
      const spreadsheetId = this.config.spreadsheetId;

      // 1. Fetch worksheet metadata to get sheetId and grid dimensions
      const spreadsheetMeta = await client.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title,gridProperties))',
      });
      const targetSheet =
        spreadsheetMeta.data.sheets?.find(
          (s) => s.properties?.title?.toLowerCase() === tabName.toLowerCase(),
        ) || spreadsheetMeta.data.sheets?.[0];
      const sheetId = targetSheet?.properties?.sheetId ?? 0;
      const actualTabName = targetSheet?.properties?.title || tabName;

      // 2. Fetch current rows to check for existing candidate / header
      const readRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${actualTabName}'!A:AB`,
      });

      let rows: any[][] = readRes.data.values || [];

      // 3. Inspect existing Google Sheets column mapping and safely migrate without data loss or column shifting
      rows = await this.migrateSheetSchemaIfOutdated(
        client,
        spreadsheetId,
        sheetId,
        actualTabName,
        rows,
      );

      // 4. Search for matching existing row by candidateId, driveFileId, or normalized email
      let targetRowIndex = -1; // 0-based index in rows array
      let maxExistingId = -1;
      let hasExistingId = false;
      const normalizedInputEmail = input.email
        ? input.email.trim().toLowerCase()
        : null;
      const cleanDriveFileId = input.driveFileId
        ? input.driveFileId.trim()
        : null;

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const cellId = parseInt(String(row[0] || '').trim(), 10);
        const cellEmail = String(row[2] || '')
          .trim()
          .toLowerCase();
        const cellCvLink = String(row[26] || '').trim();
        const cellDriveFileId = String(row[27] || '').trim();

        if (!isNaN(cellId)) {
          hasExistingId = true;
          if (cellId > maxExistingId) {
            maxExistingId = cellId;
          }
        }

        // Match by candidate ID if provided
        if (
          input.id !== undefined &&
          input.id !== null &&
          !isNaN(cellId) &&
          cellId === input.id
        ) {
          targetRowIndex = r;
          break;
        }

        // Match by Drive file ID if provided (stable identifier for crash recovery)
        if (
          cleanDriveFileId &&
          (cellDriveFileId === cleanDriveFileId ||
            cellCvLink.includes(cleanDriveFileId))
        ) {
          targetRowIndex = r;
          break;
        }

        // Match by normalized email
        if (
          normalizedInputEmail &&
          cellEmail &&
          cellEmail === normalizedInputEmail
        ) {
          targetRowIndex = r;
          break;
        }
      }

      const isUpdate = targetRowIndex !== -1;
      const existingRow = isUpdate ? rows[targetRowIndex] || [] : [];

      // Candidate ID (0 is a valid candidate ID)
      const existingIdNum = parseInt(String(existingRow[0] || '').trim(), 10);
      const fallbackNextId = hasExistingId ? maxExistingId + 1 : 0;
      const candidateId = isUpdate
        ? !isNaN(existingIdNum)
          ? existingIdNum
          : input.id !== undefined && input.id !== null
            ? input.id
            : fallbackNextId
        : input.id !== undefined && input.id !== null
          ? input.id
          : fallbackNextId;

      // Formatted fields
      const candidateName =
        input.name?.trim() || (isUpdate ? existingRow[1] : '') || '';
      const email =
        input.email?.trim() || (isUpdate ? existingRow[2] : '') || '';
      const phone = this.formatPhoneNumberForSheet(
        input.phone !== undefined && input.phone !== null
          ? input.phone
          : isUpdate
            ? existingRow[3]
            : '',
      );
      const jobRole =
        input.jobRole?.trim() || (isUpdate ? existingRow[4] : '') || '';
      const assignedHrName =
        input.assignedHrName?.trim() ||
        (isUpdate ? existingRow[5] : 'Unassigned') ||
        'Unassigned';
      const totalExperience =
        this.formatExperienceYears(input.experience) ||
        (isUpdate ? existingRow[6] : '') ||
        '';
      const currentCompany =
        this.extractCompany(input.company, input.experience) ||
        (isUpdate ? existingRow[7] : '') ||
        '';
      const applicationStatus =
        isUpdate &&
        existingRow[8] &&
        !input.applicationStatus &&
        !input.screeningStatus
          ? existingRow[8]
          : this.mapApplicationStatus(
              input.applicationStatus ||
                input.screeningStatus ||
                (isUpdate ? existingRow[8] : 'New'),
            );

      // HR-managed fields: PRESERVE existing values if updating
      const currentInterviewRound = isUpdate
        ? input.currentInterviewRound || existingRow[9] || 'Not Started'
        : input.currentInterviewRound || 'Not Started';

      // 1st Call Attempt
      const call1Date = isUpdate
        ? input.call1Date !== undefined && input.call1Date !== null
          ? input.call1Date
          : existingRow[11] || ''
        : input.call1Date || '';

      const existingCall1Status = isUpdate
        ? String(existingRow[12] || '').trim()
        : '';

      // Leave 1st Call Status blank by default for new candidates.
      // If updating, preserve existing HR-entered call status.
      // HR is solely responsible for selecting call status via dropdown.
      const call1Status = isUpdate
        ? existingCall1Status !== ''
          ? input.call1Status !== undefined &&
            input.call1Status !== null &&
            input.call1Status !== '' &&
            input.call1Status !== existingCall1Status &&
            input.call1Date !== undefined
            ? input.call1Status
            : existingCall1Status
          : input.call1Status || ''
        : input.call1Status || '';

      const call1Remarks = isUpdate
        ? input.call1Remarks !== undefined && input.call1Remarks !== null
          ? input.call1Remarks
          : existingRow[13] || ''
        : input.call1Remarks || '';

      // 2nd Call Attempt - Leave blank until corresponding call attempt is made
      const call2Date = isUpdate
        ? input.call2Date !== undefined && input.call2Date !== null
          ? input.call2Date
          : existingRow[14] || ''
        : input.call2Date || '';

      const existingCall2Status = isUpdate
        ? String(existingRow[15] || '').trim()
        : '';

      const call2Status = isUpdate
        ? existingCall2Status !== ''
          ? input.call2Status !== undefined &&
            input.call2Status !== null &&
            input.call2Status !== '' &&
            input.call2Status !== existingCall2Status &&
            input.call2Date !== undefined
            ? input.call2Status
            : existingCall2Status
          : input.call2Status || ''
        : input.call2Status || '';

      const call2Remarks = isUpdate
        ? input.call2Remarks !== undefined && input.call2Remarks !== null
          ? input.call2Remarks
          : existingRow[16] || ''
        : input.call2Remarks || '';

      // 3rd Call Attempt - Leave blank until corresponding call attempt is made
      const call3Date = isUpdate
        ? input.call3Date !== undefined && input.call3Date !== null
          ? input.call3Date
          : existingRow[17] || ''
        : input.call3Date || '';

      const existingCall3Status = isUpdate
        ? String(existingRow[18] || '').trim()
        : '';

      const call3Status = isUpdate
        ? existingCall3Status !== ''
          ? input.call3Status !== undefined &&
            input.call3Status !== null &&
            input.call3Status !== '' &&
            input.call3Status !== existingCall3Status &&
            input.call3Date !== undefined
            ? input.call3Status
            : existingCall3Status
          : input.call3Status || ''
        : input.call3Status || '';

      const call3Remarks = isUpdate
        ? input.call3Remarks !== undefined && input.call3Remarks !== null
          ? input.call3Remarks
          : existingRow[19] || ''
        : input.call3Remarks || '';

      // Calculate Total Call Attempts consistently with recorded attempts
      let computedAttempts = 0;
      if (
        (call1Date && call1Date !== '') ||
        (call1Status && call1Status !== '' && call1Status !== 'Not Answered')
      ) {
        computedAttempts = 1;
      }
      if (
        (call2Date && call2Date !== '') ||
        (call2Status && call2Status !== '')
      ) {
        computedAttempts = 2;
      }
      if (
        (call3Date && call3Date !== '') ||
        (call3Status && call3Status !== '')
      ) {
        computedAttempts = 3;
      }

      let totalCallAttempts = 0;
      if (
        input.totalCallAttempts !== undefined &&
        input.totalCallAttempts !== null
      ) {
        totalCallAttempts = Math.max(input.totalCallAttempts, computedAttempts);
      } else if (input.callCount !== undefined && input.callCount !== null) {
        totalCallAttempts = Math.max(input.callCount, computedAttempts);
      } else if (
        isUpdate &&
        existingRow[10] !== undefined &&
        existingRow[10] !== ''
      ) {
        const parsed = parseInt(String(existingRow[10]).trim(), 10);
        totalCallAttempts = Math.max(
          !isNaN(parsed) ? parsed : 0,
          computedAttempts,
        );
      } else {
        totalCallAttempts = computedAttempts;
      }

      const nextFollowUpDate = isUpdate
        ? input.nextFollowUpDate !== undefined &&
          input.nextFollowUpDate !== null
          ? input.nextFollowUpDate
          : existingRow[20] || ''
        : input.nextFollowUpDate || '';

      const automatedFollowUpEmailStatus = isUpdate
        ? input.automatedFollowUpEmailStatus !== undefined &&
          input.automatedFollowUpEmailStatus !== null
          ? input.automatedFollowUpEmailStatus
          : existingRow[21] || 'NOT_SENT'
        : input.automatedFollowUpEmailStatus || 'NOT_SENT';

      const rawSentAt = isUpdate
        ? input.followUpEmailSentAt !== undefined &&
          input.followUpEmailSentAt !== null
          ? input.followUpEmailSentAt
          : existingRow[22] || ''
        : input.followUpEmailSentAt || '';
      const followUpEmailSentAt = this.formatHumanReadableDate(rawSentAt);

      const hrRemarks = isUpdate
        ? input.hrRemarks || existingRow[23] || input.rejectionReason || ''
        : input.hrRemarks || input.rejectionReason || '';

      const lastUpdatedBy = 'AI Recruitment System';
      const lastUpdatedAt = this.formatLastUpdatedAt();

      const driveFileId =
        input.driveFileId !== undefined && input.driveFileId !== null
          ? input.driveFileId
          : isUpdate
            ? existingRow[27] || ''
            : '';

      let cvLink =
        input.cvLink !== undefined && input.cvLink !== null
          ? input.cvLink
          : input.driveFileId
            ? `=HYPERLINK("https://drive.google.com/file/d/${input.driveFileId}/view", "View CV")`
            : driveFileId
              ? `=HYPERLINK("https://drive.google.com/file/d/${driveFileId}/view", "View CV")`
              : isUpdate
                ? existingRow[26] || ''
                : '';

      if (
        cvLink &&
        typeof cvLink === 'string' &&
        cvLink.startsWith('http') &&
        !cvLink.startsWith('=')
      ) {
        cvLink = `=HYPERLINK("${cvLink}", "View CV")`;
      }

      const rowValues = [
        candidateId, // 0 (A): Candidate ID
        candidateName, // 1 (B): Candidate Name
        email, // 2 (C): Email Address
        phone, // 3 (D): Mobile Number
        jobRole, // 4 (E): Job Role Applied For
        assignedHrName, // 5 (F): Assigned HR Name
        totalExperience, // 6 (G): Total Experience (Years)
        currentCompany, // 7 (H): Current Company
        applicationStatus, // 8 (I): Application Status (Dropdown safe)
        currentInterviewRound, // 9 (J): Current Interview Round (HR field)
        totalCallAttempts, // 10 (K): Total Call Attempts (HR field)
        call1Date, // 11 (L): 1st Call Date
        call1Status, // 12 (M): 1st Call Status (HR field)
        call1Remarks, // 13 (N): 1st Call Remarks (HR field)
        call2Date, // 14 (O): 2nd Call Date
        call2Status, // 15 (P): 2nd Call Status (HR field)
        call2Remarks, // 16 (Q): 2nd Call Remarks (HR field)
        call3Date, // 17 (R): 3rd Call Date
        call3Status, // 18 (S): 3rd Call Status (HR field)
        call3Remarks, // 19 (T): 3rd Call Remarks (HR field)
        nextFollowUpDate, // 20 (U): Next Follow-up Date (HR field)
        automatedFollowUpEmailStatus, // 21 (V): Automated Follow-up Email Status
        followUpEmailSentAt, // 22 (W): Follow-up Email Sent At
        hrRemarks, // 23 (X): HR Remarks (HR field)
        lastUpdatedBy, // 24 (Y): Last Updated By
        lastUpdatedAt, // 25 (Z): Last Updated At
        cvLink, // 26 (AA): CV Link
        driveFileId, // 27 (AB): Drive File ID
      ];

      const hasFormula = rowValues.some(
        (v) => typeof v === 'string' && v.startsWith('='),
      );
      const valueInputOption = hasFormula ? 'USER_ENTERED' : 'RAW';

      if (!isUpdate) {
        // APPEND new candidate record to Google Sheets using spreadsheets.values.append
        // with INSERT_ROWS to ensure a brand new row is created and existing rows are never overwritten.
        const appendRes = await client.spreadsheets.values.append({
          spreadsheetId,
          range: `'${actualTabName}'!A:AB`,
          valueInputOption,
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: [rowValues],
          },
        });

        const updatedRange =
          appendRes.data?.updates?.updatedRange ||
          appendRes.data?.tableRange ||
          null;

        const parsedRow = this.extractRowNumberFromRange(updatedRange);
        const rowNumber = parsedRow !== null ? parsedRow : rows.length + 1;

        if (!updatedRange) {
          this.logger.warn(
            'Google Sheets append response did not include updatedRange; fallback to computed row',
            { candidateId, rowNumber, tabName: actualTabName },
          );
        }

        // Apply clean neutral formatting and dropdowns
        await this.ensureCandidateRowFormatting(
          client,
          spreadsheetId,
          sheetId,
          rowNumber,
        );

        this.logger.info(
          `Appended candidate ID ${candidateId} to Google Sheets at range ${updatedRange || `row ${rowNumber}`}`,
          {
            candidateId,
            operation: 'append',
            updatedRange: updatedRange || `row ${rowNumber}`,
            rowNumber,
            tabName: actualTabName,
          },
        );

        if (
          this.redisService?.client &&
          candidateId !== undefined &&
          candidateId !== null
        ) {
          try {
            await this.redisService.client.set(
              `recruitment:google-sheets:candidate:${candidateId}`,
              JSON.stringify({
                rowNumber,
                updatedRange:
                  updatedRange ||
                  `'${actualTabName}'!A${rowNumber}:AB${rowNumber}`,
                action: 'appended',
                updatedAt: lastUpdatedAt,
              }),
              'EX',
              86400 * 30,
            );

            const syncedHash = this.computeCallTrackingHash({
              applicationStatus,
              currentInterviewRound,
              call1Date,
              call1Status,
              call1Remarks,
              call2Date,
              call2Status,
              call2Remarks,
              call3Date,
              call3Status,
              call3Remarks,
              nextFollowUpDate,
              hrRemarks,
            });
            await this.recordSyncedHash(candidateId, syncedHash);
          } catch {}
        }

        return {
          action: 'appended',
          candidateId,
          rowNumber,
          updatedRange:
            updatedRange || `'${actualTabName}'!A${rowNumber}:AB${rowNumber}`,
        };
      } else {
        // UPDATE existing candidate record at its exact existing row
        const rowNumber = targetRowIndex + 1;
        const updateRange = `'${actualTabName}'!A${rowNumber}:AB${rowNumber}`;

        const updateRes = await client.spreadsheets.values.update({
          spreadsheetId,
          range: updateRange,
          valueInputOption,
          requestBody: {
            values: [rowValues],
          },
        });

        const updatedRange = updateRes.data?.updatedRange || updateRange;

        await this.ensureCandidateRowFormatting(
          client,
          spreadsheetId,
          sheetId,
          rowNumber,
        );

        this.logger.info(
          `Updated existing candidate ID ${candidateId} at Google Sheets row ${rowNumber}`,
          {
            candidateId,
            operation: 'update',
            updatedRange,
            rowNumber,
            tabName: actualTabName,
          },
        );

        if (
          this.redisService?.client &&
          candidateId !== undefined &&
          candidateId !== null
        ) {
          try {
            await this.redisService.client.set(
              `recruitment:google-sheets:candidate:${candidateId}`,
              JSON.stringify({
                rowNumber,
                updatedRange,
                action: 'updated',
                updatedAt: lastUpdatedAt,
              }),
              'EX',
              86400 * 30,
            );

            const syncedHash = this.computeCallTrackingHash({
              applicationStatus,
              currentInterviewRound,
              call1Date,
              call1Status,
              call1Remarks,
              call2Date,
              call2Status,
              call2Remarks,
              call3Date,
              call3Status,
              call3Remarks,
              nextFollowUpDate,
              hrRemarks,
            });
            await this.recordSyncedHash(candidateId, syncedHash);
          } catch {}
        }

        return {
          action: 'updated',
          candidateId,
          rowNumber,
          updatedRange,
        };
      }
    });
  }

  /**
   * Safely updates ONLY Column AA (CV Link) and Column AB (Drive File ID) for an existing candidate.
   * Completely preserves Columns A through Z (all HR-managed columns, call statuses, dates, remarks, etc.).
   * Uses USER_ENTERED to ensure clickable hyperlink formula rendering.
   */
  public async updateCandidateDriveColumns(
    rowNumber: number,
    driveFileId: string,
    cvLink?: string,
  ): Promise<{ rowNumber: number; cvLink: string; driveFileId: string }> {
    const client = this.getClient();
    if (!client) {
      throw new Error('Google Sheets client is not configured');
    }

    const spreadsheetId = this.config.spreadsheetId;
    const tabName = this.config.tabName || 'Candidate Tracker';
    let actualTabName = tabName;
    try {
      const spreadsheetMeta = await client.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))',
      });
      const targetSheet =
        spreadsheetMeta.data.sheets?.find(
          (s) => s.properties?.title?.toLowerCase() === tabName.toLowerCase(),
        ) || spreadsheetMeta.data.sheets?.[0];
      actualTabName = targetSheet?.properties?.title || tabName;
    } catch (err: any) {
      this.logger.warn(
        `Could not resolve sheet title from metadata, falling back to ${tabName}: ${err.message}`,
      );
    }

    const formattedCvLink =
      cvLink && cvLink.startsWith('=')
        ? cvLink
        : cvLink && cvLink.startsWith('http')
          ? `=HYPERLINK("${cvLink}", "View CV")`
          : `=HYPERLINK("https://drive.google.com/file/d/${driveFileId}/view", "View CV")`;

    const updateRange = `'${actualTabName}'!AA${rowNumber}:AB${rowNumber}`;

    await client.spreadsheets.values.update({
      spreadsheetId,
      range: updateRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[formattedCvLink, driveFileId]],
      },
    });

    this.logger.info(
      `Updated Drive columns (AA:AB) for candidate at row ${rowNumber}`,
      { rowNumber, driveFileId, tabName: actualTabName },
    );

    return { rowNumber, cvLink: formattedCvLink, driveFileId };
  }

  /**
   * Looks up an existing candidate record in Google Sheets by Drive File ID.
   */
  public async findCandidateByDriveFileId(driveFileId: string): Promise<{
    rowNumber: number;
    candidateId?: string | number;
    row: any[];
  } | null> {
    const client = this.getClient();
    if (!client || !driveFileId) return null;

    try {
      const tabName = this.config.tabName || 'Candidate Tracker';
      const spreadsheetId = this.config.spreadsheetId;

      const res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tabName}'!A:AB`,
      });

      const rows: any[][] = res.data.values || [];
      if (rows.length <= 1) return null;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowDriveFileId = String(row[27] || '').trim();
        const rowCvLink = String(row[26] || '');
        if (
          (rowDriveFileId && rowDriveFileId === driveFileId) ||
          (rowCvLink && rowCvLink.includes(driveFileId))
        ) {
          return {
            rowNumber: i + 1,
            candidateId: row[0],
            row,
          };
        }
      }
      return null;
    } catch (err: any) {
      this.logger.warn(
        `Failed to find candidate by Drive File ID in Google Sheets: ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Safely inspects the Google Sheets headers and migrates them to the new schema
   * without data loss or column shifting.
   */
  public async migrateSheetSchemaIfOutdated(
    client: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetId: number,
    actualTabName: string,
    rows: any[][],
  ): Promise<any[][]> {
    if (rows.length === 0) {
      await client.spreadsheets.values.update({
        spreadsheetId,
        range: `'${actualTabName}'!A1:AB1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [GoogleSheetsService.EXPECTED_HEADERS],
        },
      });
      await this.ensureHeaderRowFormatting(client, spreadsheetId, sheetId);
      rows.push([...GoogleSheetsService.EXPECTED_HEADERS]);
      return rows;
    }

    const existingHeaders = rows[0] || [];
    const isUpToDate =
      existingHeaders.length === GoogleSheetsService.EXPECTED_HEADERS.length &&
      existingHeaders.every(
        (h, idx) =>
          String(h || '')
            .trim()
            .toLowerCase() ===
          GoogleSheetsService.EXPECTED_HEADERS[idx].toLowerCase(),
      );

    if (isUpToDate) {
      this.logger.info(
        'Google Sheets Candidate Tracker schema is already up to date',
        {
          worksheet: actualTabName,
          detectedOldSchema: existingHeaders,
          newSchema: GoogleSheetsService.EXPECTED_HEADERS,
          migrationResult: 'ALREADY_UP_TO_DATE',
        },
      );
      return rows;
    }

    this.logger.info(
      'Migrating Google Sheets Candidate Tracker headers and columns to support separate HR call attempts',
      {
        worksheet: actualTabName,
        detectedOldSchema: existingHeaders,
        newSchema: GoogleSheetsService.EXPECTED_HEADERS,
        migrationResult: 'IN_PROGRESS',
      },
    );

    // Build map of lowercase normalized header name -> column index
    const oldHeaderMap = new Map<string, number>();
    existingHeaders.forEach((h: any, idx: number) => {
      if (h) {
        oldHeaderMap.set(String(h).trim().toLowerCase(), idx);
      }
    });

    const getCol = (row: any[], ...names: string[]): string => {
      for (const name of names) {
        const idx = oldHeaderMap.get(name.toLowerCase());
        if (idx !== undefined && row[idx] !== undefined && row[idx] !== null) {
          const val = String(row[idx]).trim();
          if (val !== '') return val;
        }
      }
      return '';
    };

    const parseDateAndStatus = (
      val: string,
    ): { date: string; status: string } => {
      if (!val) return { date: '', status: '' };
      const parts = val.split(' - ');
      if (parts.length >= 2) {
        return {
          date: parts[0].trim(),
          status: parts.slice(1).join(' - ').trim(),
        };
      }
      return { date: val.trim(), status: '' };
    };

    const migratedRows: any[][] = [];
    migratedRows.push([...GoogleSheetsService.EXPECTED_HEADERS]);

    for (let r = 1; r < rows.length; r++) {
      const oldRow = rows[r] || [];

      const candidateId = getCol(oldRow, 'candidate id', 'id');
      const candidateName = getCol(oldRow, 'candidate name', 'name');
      const email = getCol(oldRow, 'email address', 'email');
      const rawPhone = getCol(
        oldRow,
        'mobile number',
        'phone',
        'contact number',
      );
      const phone = this.formatPhoneNumberForSheet(rawPhone);
      const jobRole = getCol(
        oldRow,
        'job role applied for',
        'job role',
        'role',
      );
      const assignedHrName =
        getCol(oldRow, 'assigned hr name', 'assigned hr') || 'Unassigned';
      const totalExperience = getCol(
        oldRow,
        'total experience (years)',
        'total experience',
        'experience',
      );
      const currentCompany = getCol(oldRow, 'current company', 'company');
      const applicationStatus = this.mapApplicationStatus(
        getCol(oldRow, 'application status', 'status'),
      );
      const currentInterviewRound =
        getCol(oldRow, 'current interview round', 'interview round') ||
        'Not Started';

      // Call 1
      const rawCall1 = getCol(oldRow, 'call 1 date and status', 'call 1');
      const parsedCall1 = parseDateAndStatus(rawCall1);
      const legacyContactDate = getCol(
        oldRow,
        'last contact date',
        'last call date',
      );
      const legacyCallStatus = getCol(oldRow, 'last call status');

      const isLegacyStatusJustified =
        legacyCallStatus &&
        legacyCallStatus !== 'Not Called' &&
        legacyCallStatus.trim() !== '';

      const isLegacyDateJustified =
        legacyContactDate && legacyContactDate.trim() !== '';

      const call1Date =
        getCol(oldRow, '1st call date', 'call 1 date') ||
        parsedCall1.date ||
        (isLegacyDateJustified || isLegacyStatusJustified
          ? legacyContactDate
          : '');

      const call1Status =
        getCol(oldRow, '1st call status', 'call 1 status') ||
        parsedCall1.status ||
        (isLegacyStatusJustified ? legacyCallStatus : '');

      const call1Remarks = getCol(
        oldRow,
        '1st call remarks',
        'call 1 remarks',
        'call 1 notes',
      );

      // Call 2
      const rawCall2 = getCol(oldRow, 'call 2 date and status', 'call 2');
      const parsedCall2 = parseDateAndStatus(rawCall2);
      const call2Date =
        getCol(oldRow, '2nd call date', 'call 2 date') || parsedCall2.date;
      const call2Status =
        getCol(oldRow, '2nd call status', 'call 2 status') ||
        parsedCall2.status;
      const call2Remarks = getCol(
        oldRow,
        '2nd call remarks',
        'call 2 remarks',
        'call 2 notes',
      );

      // Call 3
      const rawCall3 = getCol(oldRow, 'call 3 date and status', 'call 3');
      const parsedCall3 = parseDateAndStatus(rawCall3);
      const call3Date =
        getCol(oldRow, '3rd call date', 'call 3 date') || parsedCall3.date;
      const call3Status =
        getCol(oldRow, '3rd call status', 'call 3 status') ||
        parsedCall3.status;
      const call3Remarks = getCol(
        oldRow,
        '3rd call remarks',
        'call 3 remarks',
        'call 3 notes',
      );

      // Total Call Attempts
      let computedAttempts = 0;
      if (call1Date !== '' || call1Status !== '') computedAttempts = 1;
      if (call2Date !== '' || call2Status !== '') computedAttempts = 2;
      if (call3Date !== '' || call3Status !== '') computedAttempts = 3;

      const rawAttempts = getCol(
        oldRow,
        'total call attempts',
        'call count',
        'call attempts',
      );
      const parsedAttempts = parseInt(rawAttempts, 10);
      const totalCallAttempts = !isNaN(parsedAttempts)
        ? Math.max(parsedAttempts, computedAttempts)
        : computedAttempts;

      const nextFollowUpDate = getCol(
        oldRow,
        'next follow-up date',
        'next follow up date',
        'follow-up date',
      );
      const automatedFollowUpEmailStatus =
        getCol(
          oldRow,
          'automated follow-up email status',
          'follow-up email status',
        ) || 'NOT_SENT';
      const followUpEmailSentAt = getCol(
        oldRow,
        'follow-up email sent at',
        'email sent at',
      );
      const hrRemarks = getCol(oldRow, 'hr remarks', 'remarks', 'notes');
      const lastUpdatedBy =
        getCol(oldRow, 'last updated by') || 'AI Recruitment System';
      const lastUpdatedAt =
        getCol(oldRow, 'last updated at') || this.formatLastUpdatedAt();
      const cvLink = getCol(
        oldRow,
        'cv link',
        'resume link',
        'cv url',
        'resume url',
      );
      const driveFileId = getCol(
        oldRow,
        'drive file id',
        'file id',
        'drive id',
      );

      migratedRows.push([
        candidateId,
        candidateName,
        email,
        phone,
        jobRole,
        assignedHrName,
        totalExperience,
        currentCompany,
        applicationStatus,
        currentInterviewRound,
        totalCallAttempts,
        call1Date,
        call1Status,
        call1Remarks,
        call2Date,
        call2Status,
        call2Remarks,
        call3Date,
        call3Status,
        call3Remarks,
        nextFollowUpDate,
        automatedFollowUpEmailStatus,
        followUpEmailSentAt,
        hrRemarks,
        lastUpdatedBy,
        lastUpdatedAt,
        cvLink,
        driveFileId,
      ]);
    }

    // Write migrated structure to sheet (A1:AB{migratedRows.length})
    await client.spreadsheets.values.update({
      spreadsheetId,
      range: `'${actualTabName}'!A1:AB${migratedRows.length}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: migratedRows,
      },
    });

    await this.ensureHeaderRowFormatting(client, spreadsheetId, sheetId);
    await this.ensureSheetColumnValidationsAndFormatting(
      client,
      spreadsheetId,
      sheetId,
      Math.max(migratedRows.length, 1000),
    );

    this.logger.info(
      'Google Sheets Candidate Tracker schema migration executed successfully',
      {
        worksheet: actualTabName,
        detectedOldSchema: existingHeaders,
        newSchema: GoogleSheetsService.EXPECTED_HEADERS,
        migrationResult: 'SUCCESS',
        candidateRowsMigrated: Math.max(0, migratedRows.length - 1),
      },
    );

    return migratedRows;
  }

  /**
   * Applies dark blue header formatting with white bold text exclusively to Row 1.
   */
  public async ensureHeaderRowFormatting(
    client: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetId: number,
  ): Promise<void> {
    try {
      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: GoogleSheetsService.EXPECTED_HEADERS.length,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: {
                      red: 0.11764706,
                      green: 0.22352941,
                      blue: 0.5372549,
                    },
                    textFormat: {
                      foregroundColor: { red: 1, green: 1, blue: 1 },
                      fontFamily: 'Roboto',
                      fontSize: 10,
                      bold: true,
                    },
                    horizontalAlignment: 'CENTER',
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                  },
                },
                fields:
                  'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
              },
            },
          ],
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to apply header styling to Row 1: ${this.sanitizeError(err)}`,
      );
    }
  }

  /**
   * Ensures candidate data rows have a clean, professional, consistent appearance:
   * - Clean white background
   * - Readable dark neutral text (bold: false)
   * - Middle vertical alignment and text wrap
   * - Explicit interactive dropdown data validation (showCustomUi: true) for:
   *   - Column I (Col index 8): Application Status
   *   - Column J (Col index 9): Current Interview Round
   *   - Column M (Col index 12): 1st Call Status
   *   - Column P (Col index 15): 2nd Call Status
   *   - Column S (Col index 18): 3rd Call Status
   *   - Column V (Col index 21): Automated Follow-up Email Status
   */
  public async ensureCandidateRowFormatting(
    client: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetId: number,
    rowNumber: number,
  ): Promise<void> {
    try {
      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 0,
                  endColumnIndex: GoogleSheetsService.EXPECTED_HEADERS.length,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 1, green: 1, blue: 1 },
                    textFormat: {
                      foregroundColor: { red: 0.15, green: 0.15, blue: 0.15 },
                      fontFamily: 'Roboto',
                      fontSize: 10,
                      bold: false,
                    },
                    verticalAlignment: 'MIDDLE',
                    wrapStrategy: 'WRAP',
                  },
                },
                fields:
                  'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)',
              },
            },
            // Clear any prior data validation on this row before setting specific column dropdowns
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 0,
                  endColumnIndex: GoogleSheetsService.EXPECTED_HEADERS.length,
                },
              },
            },
            // Configure Column D (3: Mobile Number) as plain TEXT
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 3,
                  endColumnIndex: 4,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'TEXT',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            // Configure Date columns L (11), O (14), R (17) as DATE_TIME
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 11,
                  endColumnIndex: 12,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'DATE_TIME',
                      pattern: 'yyyy-mm-dd hh:mm:ss',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 14,
                  endColumnIndex: 15,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'DATE_TIME',
                      pattern: 'yyyy-mm-dd hh:mm:ss',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 17,
                  endColumnIndex: 18,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'DATE_TIME',
                      pattern: 'yyyy-mm-dd hh:mm:ss',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            // Configure Remarks columns N (13), Q (16), T (19) as plain TEXT
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 13,
                  endColumnIndex: 14,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'TEXT',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 16,
                  endColumnIndex: 17,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'TEXT',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 19,
                  endColumnIndex: 20,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'TEXT',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 8,
                  endColumnIndex: 9,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: GoogleSheetsService.APPLICATION_STATUS_OPTIONS.map(
                      (val) => ({ userEnteredValue: val }),
                    ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 9,
                  endColumnIndex: 10,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: GoogleSheetsService.INTERVIEW_ROUND_OPTIONS.map(
                      (val) => ({ userEnteredValue: val }),
                    ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 12,
                  endColumnIndex: 13,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: GoogleSheetsService.CALL_STATUS_OPTIONS.map(
                      (val) => ({ userEnteredValue: val }),
                    ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 15,
                  endColumnIndex: 16,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: GoogleSheetsService.CALL_STATUS_OPTIONS.map(
                      (val) => ({ userEnteredValue: val }),
                    ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 18,
                  endColumnIndex: 19,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: GoogleSheetsService.CALL_STATUS_OPTIONS.map(
                      (val) => ({ userEnteredValue: val }),
                    ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: rowNumber - 1,
                  endRowIndex: rowNumber,
                  startColumnIndex: 21,
                  endColumnIndex: 22,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values:
                      GoogleSheetsService.FOLLOW_UP_EMAIL_STATUS_OPTIONS.map(
                        (val) => ({ userEnteredValue: val }),
                      ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
          ],
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to apply clean formatting and dropdowns to candidate row ${rowNumber}: ${this.sanitizeError(err)}`,
      );
    }
  }

  /**
   * Applies canonical column-wide formatting, data validations, and date/text formats across the entire sheet:
   * 1. Completely clears all prior data validation rules across the entire sheet grid (A1:Z{rowCount}).
   * 2. Configures date columns L (11), O (14), and R (17) with DATE_TIME number formatting.
   *    Explicitly ensures NO dropdown or data validation rule exists on L, O, or R.
   * 3. Applies ONE_OF_LIST dropdown validation ONLY to call status columns:
   *    - Column M (12): 1st Call Status
   *    - Column P (15): 2nd Call Status
   *    - Column S (18): 3rd Call Status
   *    Allowed options: ['Not Answered', 'Answered', 'Busy', 'Call Back Requested', 'Invalid Number', 'Switched Off']
   * 4. Keeps remarks columns N (13), Q (16), and T (19) as plain TEXT with NO data validation.
   * 5. Sets dropdown validation for:
   *    - Column I (8): Application Status
   *    - Column J (9): Current Interview Round
   *    - Column V (21): Automated Follow-up Email Status
   */
  public async ensureSheetColumnValidationsAndFormatting(
    client: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetId: number,
    rowCount: number,
  ): Promise<void> {
    try {
      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            // 1. Clear ALL data validation rules across the entire sheet grid
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: rowCount,
                  startColumnIndex: 0,
                  endColumnIndex: GoogleSheetsService.EXPECTED_HEADERS.length,
                },
              },
            },
            // Configure Column D (3: Mobile Number) as plain TEXT across all candidate rows
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 3,
                  endColumnIndex: 4,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'TEXT',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            // 2. Configure Date columns L (11), O (14), R (17) as DATE_TIME
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 11,
                  endColumnIndex: 12,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'DATE_TIME',
                      pattern: 'yyyy-mm-dd hh:mm:ss',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 14,
                  endColumnIndex: 15,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'DATE_TIME',
                      pattern: 'yyyy-mm-dd hh:mm:ss',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 17,
                  endColumnIndex: 18,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'DATE_TIME',
                      pattern: 'yyyy-mm-dd hh:mm:ss',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            // Configure Follow-up Email Sent At column W (22) as DATE_TIME
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 22,
                  endColumnIndex: 23,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'DATE_TIME',
                      pattern: 'yyyy-mm-dd hh:mm:ss',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            // 3. Configure Remarks columns N (13), Q (16), T (19) as plain TEXT
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 13,
                  endColumnIndex: 14,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'TEXT',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 16,
                  endColumnIndex: 17,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'TEXT',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 19,
                  endColumnIndex: 20,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'TEXT',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            // 4. Configure Call Status columns M (12), P (15), S (18) as TEXT
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 12,
                  endColumnIndex: 13,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'TEXT',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 15,
                  endColumnIndex: 16,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'TEXT',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 18,
                  endColumnIndex: 19,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: {
                      type: 'TEXT',
                    },
                  },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
            // 5. Dropdown validations ONLY on call statuses M (12), P (15), S (18)
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 12,
                  endColumnIndex: 13,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: GoogleSheetsService.CALL_STATUS_OPTIONS.map(
                      (val) => ({
                        userEnteredValue: val,
                      }),
                    ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 15,
                  endColumnIndex: 16,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: GoogleSheetsService.CALL_STATUS_OPTIONS.map(
                      (val) => ({
                        userEnteredValue: val,
                      }),
                    ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 18,
                  endColumnIndex: 19,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: GoogleSheetsService.CALL_STATUS_OPTIONS.map(
                      (val) => ({
                        userEnteredValue: val,
                      }),
                    ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            // 5. Dropdown validations on I (8: Application Status), J (9: Current Interview Round), V (21: Follow-up Status)
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 8,
                  endColumnIndex: 9,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: GoogleSheetsService.APPLICATION_STATUS_OPTIONS.map(
                      (val) => ({ userEnteredValue: val }),
                    ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 9,
                  endColumnIndex: 10,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values: GoogleSheetsService.INTERVIEW_ROUND_OPTIONS.map(
                      (val) => ({ userEnteredValue: val }),
                    ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            {
              setDataValidation: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: rowCount,
                  startColumnIndex: 21,
                  endColumnIndex: 22,
                },
                rule: {
                  condition: {
                    type: 'ONE_OF_LIST',
                    values:
                      GoogleSheetsService.FOLLOW_UP_EMAIL_STATUS_OPTIONS.map(
                        (val) => ({ userEnteredValue: val }),
                      ),
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
          ],
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to apply sheet-wide column formatting and validations: ${this.sanitizeError(err)}`,
      );
    }
  }

  /**
   * Maps screening/application status to allowed dropdown values in Google Sheets:
   * ['New', 'Shortlisted', 'On Hold', 'Rejected', 'Selected']
   */
  public mapApplicationStatus(status?: string | null): string {
    if (!status) return 'New';
    const upper = status.trim().toUpperCase();
    if (upper === 'SHORTLIST' || upper === 'SHORTLISTED') {
      return 'Shortlisted';
    }
    if (upper === 'REJECT' || upper === 'REJECTED') {
      return 'Rejected';
    }
    if (upper === 'MANUAL_REVIEW') {
      return 'New';
    }
    if (upper === 'ON HOLD' || upper === 'ON_HOLD') {
      return 'On Hold';
    }
    if (upper === 'SELECTED') {
      return 'Selected';
    }

    // Direct match against allowed options (case-insensitive)
    const allowed = GoogleSheetsService.APPLICATION_STATUS_OPTIONS;
    const matched = allowed.find(
      (opt) => opt.toLowerCase() === status.trim().toLowerCase(),
    );
    return matched || 'New';
  }

  /**
   * Helper to format total experience years from various formats.
   */
  public formatExperienceYears(experience: any): string {
    if (experience === null || experience === undefined) return '';
    if (typeof experience === 'number') return String(experience);
    if (typeof experience === 'string') return experience.trim();
    if (Array.isArray(experience)) {
      if (experience.length === 0) return '0';
      return String(experience.length);
    }
    return '';
  }

  /**
   * Helper to format last updated timestamp in clean, human-readable date format (YYYY-MM-DD).
   */
  public formatLastUpdatedAt(date: Date = new Date()): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Helper to format timestamps into clean, human-readable date and time (YYYY-MM-DD HH:mm:ss in IST)
   * Prevents raw ISO strings (e.g. 2026-10-19T05:14:04.570Z) from cluttering spreadsheet cells.
   */
  public formatHumanReadableDate(
    dateInput?: Date | string | number | null,
  ): string {
    if (!dateInput) return '';
    const trimmed =
      typeof dateInput === 'string' ? dateInput.trim() : dateInput;
    if (!trimmed) return '';

    if (
      typeof trimmed === 'string' &&
      /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(trimmed)
    ) {
      return trimmed;
    }

    const d =
      typeof trimmed === 'string' || typeof trimmed === 'number'
        ? new Date(trimmed)
        : trimmed;
    if (!(d instanceof Date) || isNaN(d.getTime())) {
      return String(trimmed);
    }

    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      return formatter.format(d).replace(',', '').trim();
    } catch {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    }
  }

  /**
   * Helper to extract current company from candidate experience array or company string.
   */
  public extractCompany(company?: string | null, experience?: any): string {
    if (company && typeof company === 'string' && company.trim().length > 0) {
      return company.trim();
    }
    if (
      Array.isArray(experience) &&
      experience.length > 0 &&
      typeof experience[0] === 'object'
    ) {
      return experience[0]?.company?.trim() || '';
    }
    return '';
  }

  /**
   * Extracts the 1-based target row number from an A1-notation range string.
   * e.g., "'Candidate Tracker'!A4:Q4" -> 4, "A2:Q2" -> 2, "Candidate Tracker!A7" -> 7
   */
  public extractRowNumberFromRange(
    updatedRange?: string | null,
  ): number | null {
    if (!updatedRange || typeof updatedRange !== 'string') {
      return null;
    }
    // Strip tab name if present: e.g. "'Candidate Tracker'!A4:Q4" -> "A4:Q4"
    const cellRange = updatedRange.includes('!')
      ? updatedRange.substring(updatedRange.lastIndexOf('!') + 1)
      : updatedRange;

    // Match end row in range like "A4:Q4" -> 4
    const endRowMatch = cellRange.match(/:[A-Za-z]+(\d+)/i);
    if (endRowMatch && endRowMatch[1]) {
      const parsed = parseInt(endRowMatch[1], 10);
      if (!isNaN(parsed)) return parsed;
    }

    // Match start row in range like "A4" or "A4:Q4" -> 4
    const startRowMatch = cellRange.match(/^[A-Za-z]+(\d+)/i);
    if (startRowMatch && startRowMatch[1]) {
      const parsed = parseInt(startRowMatch[1], 10);
      if (!isNaN(parsed)) return parsed;
    }

    return null;
  }

  private inMemoryLock: Promise<void> = Promise.resolve();

  private async acquireInMemoryLock(): Promise<() => void> {
    let release: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentLock = this.inMemoryLock;
    this.inMemoryLock = this.inMemoryLock.then(() => nextLock);
    await currentLock;
    return release!;
  }

  /**
   * Executes a write task inside an in-memory lock and exclusive distributed lock (Redis) with retry.
   */
  private async executeWithLock<T>(task: () => Promise<T>): Promise<T> {
    const releaseInMemory = await this.acquireInMemoryLock();
    try {
      return await this.executeWithDistributedLock(task);
    } finally {
      releaseInMemory();
    }
  }

  /**
   * Executes with distributed Redis lock and retry.
   */
  private async executeWithDistributedLock<T>(
    task: () => Promise<T>,
  ): Promise<T> {
    const lockToken = crypto.randomUUID();
    let lockAcquired = false;

    if (this.redisService?.client) {
      try {
        const res = await this.redisService.client.set(
          GoogleSheetsService.REDIS_LOCK_KEY,
          lockToken,
          'EX',
          GoogleSheetsService.REDIS_LOCK_TTL_SECONDS,
          'NX',
        );
        lockAcquired = res === 'OK';

        // Retry if lock was held by another concurrent worker
        if (!lockAcquired) {
          for (let attempt = 0; attempt < 25; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            const retryRes = await this.redisService.client.set(
              GoogleSheetsService.REDIS_LOCK_KEY,
              lockToken,
              'EX',
              GoogleSheetsService.REDIS_LOCK_TTL_SECONDS,
              'NX',
            );
            if (retryRes === 'OK') {
              lockAcquired = true;
              break;
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(
          'Redis lock attempt failed; proceeding with in-memory lock',
          { cause: this.sanitizeError(err) },
        );
      }
    }

    try {
      return await this.executeWithRetry(task);
    } finally {
      if (lockAcquired && this.redisService?.client) {
        try {
          const currentToken = await this.redisService.client.get(
            GoogleSheetsService.REDIS_LOCK_KEY,
          );
          if (currentToken === lockToken) {
            await this.redisService.client.del(
              GoogleSheetsService.REDIS_LOCK_KEY,
            );
          }
        } catch {}
      }
    }
  }

  /**
   * Determines whether a Google Sheets API error is transient and safe to retry.
   * Permanent errors (400, 401, 403, 404, invalid credentials) fail fast.
   */
  public isTransientError(err: any): boolean {
    if (!err) return false;
    const status =
      err.status ||
      err.code ||
      err.response?.status ||
      err.response?.data?.error?.code;

    // Definite permanent error codes
    if (status === 400 || status === 401 || status === 403 || status === 404) {
      return false;
    }

    // Definite transient status codes
    if (
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504
    ) {
      return true;
    }

    const msg = String(err.message || '').toLowerCase();
    // Permanent error messages
    if (
      msg.includes('invalid_grant') ||
      msg.includes('permission denied') ||
      msg.includes('unauthorized') ||
      msg.includes('not found') ||
      msg.includes('bad request')
    ) {
      return false;
    }

    // Transient keywords
    if (
      msg.includes('503') ||
      msg.includes('429') ||
      msg.includes('service unavailable') ||
      msg.includes('backend error') ||
      msg.includes('rate limit') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('gaxios')
    ) {
      return true;
    }

    // Default to transient for unexpected network/service exceptions
    return true;
  }

  /**
   * Retries an async task with bounded exponential backoff and jitter on transient errors.
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries = GoogleSheetsService.MAX_RETRIES,
  ): Promise<T> {
    let attempt = 0;
    let lastError: any;

    while (attempt < maxRetries) {
      try {
        return await fn();
      } catch (err: any) {
        attempt++;
        lastError = err;

        // Permanent errors fail fast without wasteful retries
        if (!this.isTransientError(err) || attempt >= maxRetries) {
          break;
        }

        const jitter = Math.floor(Math.random() * 200);
        const backoffMs = Math.min(
          500 * Math.pow(2, attempt - 1) + jitter,
          3000,
        );
        this.logger.warn(
          `Google Sheets operation failed with transient error (attempt ${attempt}/${maxRetries}); retrying in ${backoffMs}ms...`,
          { cause: this.sanitizeError(err) },
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError;
  }

  /**
   * Sanitizes errors to prevent credentials, keys, or tokens from leaking to logs.
   */
  public sanitizeError(err: any): string {
    const raw = String(err?.message || err || 'Unknown Google Sheets error');
    return raw
      .replace(/private_key=[^,\s]+/gi, 'private_key=***')
      .replace(/key=[^,\s]+/gi, 'key=***')
      .replace(/token=[^,\s]+/gi, 'token=***')
      .replace(/secret=[^,\s]+/gi, 'secret=***')
      .replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer ***')
      .slice(0, 500);
  }
}
