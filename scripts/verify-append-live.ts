import * as path from 'path';
import * as dotenv from 'dotenv';
import { GoogleSheetsService } from '../src/candidate/google-sheets.service';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export async function verifyAppendLive() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const keyFile = process.env.GOOGLE_SHEETS_KEY_FILE;
  const tabName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Candidate Tracker';

  console.log(
    '=== Running Live Google Sheets Append & Duplicate Verification ===',
  );
  console.log(`Spreadsheet ID: ${spreadsheetId}`);
  console.log(`Tab: ${tabName}`);

  const mockConfig: any = {
    spreadsheetId,
    keyFile: path.resolve(process.cwd(), keyFile!),
    tabName,
  };

  const service = new GoogleSheetsService(mockConfig, { client: null } as any);

  // 1. Read existing rows before live test
  const client = service.getClient()!;
  const beforeRes = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A1:Q10`,
  });
  const initialRows = beforeRes.data.values || [];
  console.log(`Initial rows count: ${initialRows.length}`);
  const initialRow2 = [...(initialRows[1] || [])];
  const initialRow3 = [...(initialRows[2] || [])];
  console.log(`Row 2 Candidate ID: ${initialRow2[0]}, Name: ${initialRow2[1]}`);
  console.log(`Row 3 Candidate ID: ${initialRow3[0]}, Name: ${initialRow3[1]}`);

  // 2. Append new test candidate
  const testCandidate = {
    id: 999999,
    name: '__LIVE_TEST_APPEND_VERIFY__',
    email: 'live_test_append_verify@example.com',
    phone: '+1 999-999-9999',
    jobRole: 'Automation Test Engineer',
    assignedHrName: 'Aastha',
    experience: '5 years',
    company: 'Test Automation Lab',
    screeningStatus: 'SHORTLIST',
  };

  console.log('\n[Step 1: Appending new candidate...]');
  const appendResult = await service.saveCandidate(testCandidate);
  console.log('Append result:', JSON.stringify(appendResult, null, 2));

  if (appendResult.action !== 'appended') {
    throw new Error(`Expected action 'appended', got '${appendResult.action}'`);
  }
  if (appendResult.rowNumber !== 4) {
    throw new Error(`Expected rowNumber 4, got ${appendResult.rowNumber}`);
  }

  // 3. Verify in Google Sheets that Candidate 999999 is at Row 4
  const afterAppendRes = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A1:Q10`,
  });
  const rowsAfterAppend = afterAppendRes.data.values || [];
  console.log(`Rows count after append: ${rowsAfterAppend.length}`);

  const row4 = rowsAfterAppend[3];
  console.log(
    `Row 4: ID=${row4?.[0]}, Name=${row4?.[1]}, Email=${row4?.[2]}, Range=${appendResult.updatedRange}`,
  );

  if (
    String(row4?.[0]) !== '999999' ||
    row4?.[1] !== '__LIVE_TEST_APPEND_VERIFY__'
  ) {
    throw new Error(
      `Row 4 content does not match appended candidate! Row 4 is: ${JSON.stringify(row4)}`,
    );
  }

  // 4. Verify Row 2 and Row 3 were NOT modified
  console.log('\n[Step 2: Verifying previous rows are untouched...]');
  const currentRow2 = rowsAfterAppend[1];
  const currentRow3 = rowsAfterAppend[2];
  if (JSON.stringify(currentRow2) !== JSON.stringify(initialRow2)) {
    throw new Error(
      `Row 2 was modified during append! Before: ${JSON.stringify(initialRow2)}, After: ${JSON.stringify(currentRow2)}`,
    );
  }
  if (JSON.stringify(currentRow3) !== JSON.stringify(initialRow3)) {
    throw new Error(
      `Row 3 was modified during append! Before: ${JSON.stringify(initialRow3)}, After: ${JSON.stringify(currentRow3)}`,
    );
  }
  console.log(
    'PASS: Previous candidates (Row 2 and Row 3) are completely untouched!',
  );

  // 5. Test idempotency/retry on same candidate
  console.log(
    '\n[Step 3: Retrying same candidate to verify no duplicate row is appended...]',
  );
  const retryResult = await service.saveCandidate({
    ...testCandidate,
    jobRole: 'Lead Automation Engineer',
  });
  console.log('Retry result:', JSON.stringify(retryResult, null, 2));

  if (retryResult.action !== 'updated') {
    throw new Error(
      `Expected retry action 'updated', got '${retryResult.action}'`,
    );
  }
  if (retryResult.rowNumber !== 4) {
    throw new Error(`Expected retry rowNumber 4, got ${retryResult.rowNumber}`);
  }

  const afterRetryRes = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A1:Q10`,
  });
  const rowsAfterRetry = afterRetryRes.data.values || [];
  if (rowsAfterRetry.length !== 4) {
    throw new Error(
      `Expected exactly 4 rows after retry, found ${rowsAfterRetry.length}! Duplicate was created!`,
    );
  }
  console.log(
    'PASS: Retried candidate updated row 4 without appending duplicate row!',
  );

  // 6. Clean up: Delete test row (Row 4) to leave sheet in original state
  console.log('\n[Step 4: Cleaning up test row 4...]');
  const meta = await client.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  });
  const sheetId =
    meta.data.sheets?.find((s: any) => s.properties?.title === tabName)
      ?.properties?.sheetId ?? 0;

  await client.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: 3, // 0-based index 3 is Row 4
              endIndex: 4,
            },
          },
        },
      ],
    },
  });

  // Verify cleanup
  const finalRes = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A1:Q10`,
  });
  const finalRows = finalRes.data.values || [];
  console.log(`Final row count after cleanup: ${finalRows.length}`);
  if (finalRows.length !== 3) {
    throw new Error(
      `Cleanup failed: expected 3 rows, found ${finalRows.length}`,
    );
  }
  console.log(
    'PASS: Test row safely cleaned up. Sheet restored to initial state.',
  );
  console.log('\n=== LIVE GOOGLE SHEETS VERIFICATION SUCCESSFUL ===');
}

if (require.main === module) {
  verifyAppendLive()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('LIVE VERIFICATION FAILED:', err);
      process.exit(1);
    });
}
