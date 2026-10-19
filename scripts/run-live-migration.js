/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment from project root
const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

// Import compiled GoogleSheetsService from dist
const {
  GoogleSheetsService,
} = require('../dist/candidate/google-sheets.service');

async function runLiveMigrationAndVerify() {
  console.log(
    '=== Google Sheets Candidate Tracker Live Schema Migration & Verification ===\n',
  );

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const keyFile = path.resolve(
    __dirname,
    '..',
    process.env.GOOGLE_SHEETS_KEY_FILE,
  );
  const tabName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Candidate Tracker';

  console.log(`Target Spreadsheet ID: ${spreadsheetId}`);
  console.log(`Key File: ${keyFile}`);
  console.log(`Tab Name: ${tabName}\n`);

  if (!spreadsheetId || !fs.existsSync(keyFile)) {
    throw new Error('Google Sheets configuration or key file is missing');
  }

  const config = {
    spreadsheetId,
    keyFile,
    tabName,
  };

  const redisService = { client: null };
  const service = new GoogleSheetsService(config, redisService);

  // 1. Run explicit idempotent migration
  console.log('[Step 1] Executing ensureCandidateTrackerSheet()...');
  const migrationResult = await service.ensureCandidateTrackerSheet();
  console.log(
    'Migration Execution Result:',
    JSON.stringify(migrationResult, null, 2),
  );

  // 2. Read back actual live sheet after migration
  console.log(
    '\n[Step 2] Reading back actual live sheet headers and candidate rows...',
  );
  const client = service.getClient();
  if (!client) {
    throw new Error('Failed to get Google Sheets client');
  }

  const readRes = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A1:Z10`,
  });

  const rows = readRes.data.values || [];
  console.log(`Total rows in live sheet: ${rows.length}`);

  if (rows.length === 0) {
    throw new Error('Sheet is empty after migration!');
  }

  const headers = rows[0] || [];
  console.log(`\nLive Header Columns Count: ${headers.length}`);

  console.log('\n--- Live Headers (Row 1) ---');
  headers.forEach((h, idx) => {
    const letter = String.fromCharCode(65 + idx);
    console.log(`  ${letter} (index ${idx}): "${h}"`);
  });

  // Verify header match
  if (headers.length !== GoogleSheetsService.EXPECTED_HEADERS.length) {
    throw new Error(
      `Header length mismatch! Expected ${GoogleSheetsService.EXPECTED_HEADERS.length}, got ${headers.length}`,
    );
  }

  for (let i = 0; i < GoogleSheetsService.EXPECTED_HEADERS.length; i++) {
    const expected = GoogleSheetsService.EXPECTED_HEADERS[i];
    const actual = headers[i];
    if (actual !== expected) {
      throw new Error(
        `Column ${String.fromCharCode(65 + i)} mismatch! Expected "${expected}", got "${actual}"`,
      );
    }
  }

  console.log(
    '\n✅ All 26 canonical headers match EXPECTED_HEADERS perfectly (A through Z)!',
  );

  // Verify candidate data rows
  console.log('\n--- Live Candidate Data Verification ---');
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    console.log(
      `\nCandidate Row ${r + 1} (ID: ${row[0]}, Name: "${row[1]}", Email: "${row[2]}"):`,
    );
    console.log(`  Col A (ID): ${row[0]}`);
    console.log(`  Col B (Name): ${row[1]}`);
    console.log(`  Col C (Email): ${row[2]}`);
    console.log(`  Col D (Phone): ${row[3]}`);
    console.log(`  Col E (Role): ${row[4]}`);
    console.log(`  Col F (Assigned HR): ${row[5]}`);
    console.log(`  Col G (Experience): ${row[6]}`);
    console.log(`  Col H (Company): ${row[7]}`);
    console.log(`  Col I (Application Status): ${row[8]}`);
    console.log(`  Col J (Interview Round): ${row[9]}`);
    console.log(`  Col K (Total Call Attempts): ${row[10]}`);
    console.log(`  Col L (1st Call Date): "${row[11] || ''}"`);
    console.log(`  Col M (1st Call Status): "${row[12] || ''}"`);
    console.log(`  Col N (1st Call Remarks): "${row[13] || ''}"`);
    console.log(`  Col O (2nd Call Date): "${row[14] || ''}"`);
    console.log(`  Col P (2nd Call Status): "${row[15] || ''}"`);
    console.log(`  Col Q (2nd Call Remarks): "${row[16] || ''}"`);
    console.log(`  Col R (3rd Call Date): "${row[17] || ''}"`);
    console.log(`  Col S (3rd Call Status): "${row[18] || ''}"`);
    console.log(`  Col T (3rd Call Remarks): "${row[19] || ''}"`);
    console.log(`  Col U (Next Follow-up Date): "${row[20] || ''}"`);
    console.log(`  Col V (Auto Email Status): "${row[21] || ''}"`);
    console.log(`  Col W (Email Sent At): "${row[22] || ''}"`);
    console.log(`  Col X (HR Remarks): "${(row[23] || '').slice(0, 50)}..."`);
    console.log(`  Col Y (Last Updated By): "${row[24] || ''}"`);
    console.log(`  Col Z (Last Updated At): "${row[25] || ''}"`);

    // Integrity checks
    if (!row[0] || !row[1] || !row[2]) {
      throw new Error(
        `Row ${r + 1} corrupted: missing required candidate fields`,
      );
    }
    if (!row[23] || !row[23].length) {
      throw new Error(
        `Row ${r + 1} corrupted: HR Remarks was lost during migration!`,
      );
    }
  }

  // 3. Verify idempotency
  console.log(
    '\n[Step 3] Verifying migration idempotency (running second time)...',
  );
  const secondRunResult = await service.ensureCandidateTrackerSheet();
  console.log('Second Run Result:', JSON.stringify(secondRunResult, null, 2));
  if (secondRunResult.status !== 'up-to-date') {
    throw new Error(
      `Expected status 'up-to-date' on second run, got '${secondRunResult.status}'`,
    );
  }

  console.log(
    '\n🎉 LIVE SCHEMA MIGRATION AND VERIFICATION COMPLETED SUCCESSFULLY!',
  );
}

runLiveMigrationAndVerify().catch((err) => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
