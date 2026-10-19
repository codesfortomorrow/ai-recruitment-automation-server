import { registerAs } from '@nestjs/config';

export interface GoogleSheetsConfig {
  spreadsheetId: string;
  keyFile: string;
  tabName: string;
  pollingEnabled: boolean;
  pollingIntervalMinutes: number;
}

export const googleSheetsConfigFactory = registerAs(
  'googleSheets',
  (): GoogleSheetsConfig => ({
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || '',
    keyFile:
      process.env.GOOGLE_SHEETS_KEY_FILE?.trim() ||
      './config/google-service-account.json',
    tabName: process.env.GOOGLE_SHEETS_TAB_NAME?.trim() || 'Candidate Tracker',
    pollingEnabled: process.env.GOOGLE_SHEETS_POLLING_ENABLED !== 'false',
    pollingIntervalMinutes:
      parseInt(process.env.GOOGLE_SHEETS_POLLING_INTERVAL_MINUTES || '2', 10) ||
      2,
  }),
);
