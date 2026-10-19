import { registerAs } from '@nestjs/config';

export interface ExcelSyncConfig {
  path: string;
  intervalMinutes: number;
  enabled: boolean;
}

export const excelSyncConfigFactory = registerAs(
  'excelSync',
  (): ExcelSyncConfig => {
    const rawInterval = parseInt(
      process.env.CANDIDATE_EXCEL_SYNC_INTERVAL_MINUTES || '2',
      10,
    );
    const intervalMinutes =
      !isNaN(rawInterval) && rawInterval > 0 ? rawInterval : 2;

    const rawEnabled =
      process.env.CANDIDATE_EXCEL_SYNC_ENABLED?.trim()?.toLowerCase();
    // Local Excel file is the primary source of truth for candidate records.
    // Enabled by default unless explicitly disabled with 'false' or '0'.
    const enabled = rawEnabled === 'false' || rawEnabled === '0' ? false : true;

    return {
      path: process.env.CANDIDATE_EXCEL_PATH || './data/candidates.xlsx',
      intervalMinutes,
      enabled,
    };
  },
);
