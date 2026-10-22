import * as fs from 'fs';
import * as path from 'path';
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
  (): GoogleSheetsConfig => {
    let keyFile = process.env.GOOGLE_SHEETS_KEY_FILE?.trim();
    if (!keyFile) {
      const defaultPath = './config/google-service-account.json';
      if (fs.existsSync(path.resolve(process.cwd(), defaultPath))) {
        keyFile = defaultPath;
      } else {
        const configDir = path.resolve(process.cwd(), 'config');
        if (fs.existsSync(configDir)) {
          const files = fs
            .readdirSync(configDir)
            .filter((f) => f.endsWith('.json') && !f.endsWith('.example.json'));
          if (files.length > 0) {
            keyFile = `./config/${files[0]}`;
          }
        }
      }
    }

    return {
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || '',
      keyFile: keyFile || './config/google-service-account.json',
      tabName:
        process.env.GOOGLE_SHEETS_TAB_NAME?.trim() || 'Candidate Tracker',
      pollingEnabled: process.env.GOOGLE_SHEETS_POLLING_ENABLED !== 'false',
      pollingIntervalMinutes:
        parseInt(
          process.env.GOOGLE_SHEETS_POLLING_INTERVAL_MINUTES || '2',
          10,
        ) || 2,
    };
  },
);
