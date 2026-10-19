/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
const dotenv = require('dotenv');
const { google } = require('googleapis');

const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

async function verifyLiveDropdowns() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const keyFile = path.resolve(
    __dirname,
    '..',
    process.env.GOOGLE_SHEETS_KEY_FILE,
  );
  const tabName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Candidate Tracker';

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  console.log(
    '=== Verifying Google Sheets Column Types & Data Validations ===\n',
  );

  // Fetch first 10 rows with grid data
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`'${tabName}'!A1:Z10`],
    includeGridData: true,
  });

  const sheet = res.data.sheets?.[0];
  const rows = sheet?.data?.[0]?.rowData || [];

  const EXPECTED_CALL_STATUSES = [
    'Not Answered',
    'Answered',
    'Busy',
    'Call Back Requested',
    'Invalid Number',
    'Switched Off',
  ];

  // Verify across multiple candidate and empty rows (Row 2, Row 3, Row 4, Row 10)
  const rowsToTest = [1, 2, 3, 4, 9]; // 0-indexed: row 2, 3, 4, 5, 10

  for (const rIdx of rowsToTest) {
    const rowNumber = rIdx + 1;
    const rowCells = rows[rIdx]?.values || [];
    console.log(`\n--- Inspecting Row ${rowNumber} ---`);

    // Date columns: L (11), O (14), R (17)
    const dateColIndices = [
      { name: '1st Call Date', col: 'L', idx: 11 },
      { name: '2nd Call Date', col: 'O', idx: 14 },
      { name: '3rd Call Date', col: 'R', idx: 17 },
    ];

    for (const d of dateColIndices) {
      const cell = rowCells[d.idx];
      const hasValidation = Boolean(cell?.dataValidation);
      const numberFormat = cell?.userEnteredFormat?.numberFormat?.type;
      console.log(
        `  Col ${d.col} (${d.name}): dataValidation=${hasValidation} (Expected: false), numberFormat=${numberFormat} (Expected: DATE_TIME)`,
      );

      if (hasValidation) {
        throw new Error(
          `Row ${rowNumber} Col ${d.col} (${d.name}) MUST NOT have a data validation/dropdown!`,
        );
      }
      if (numberFormat !== 'DATE_TIME') {
        throw new Error(
          `Row ${rowNumber} Col ${d.col} (${d.name}) numberFormat must be DATE_TIME, got ${numberFormat}`,
        );
      }
    }

    // Call status columns: M (12), P (15), S (18)
    const statusColIndices = [
      { name: '1st Call Status', col: 'M', idx: 12 },
      { name: '2nd Call Status', col: 'P', idx: 15 },
      { name: '3rd Call Status', col: 'S', idx: 18 },
    ];

    for (const s of statusColIndices) {
      const cell = rowCells[s.idx];
      const hasValidation = Boolean(cell?.dataValidation);
      const condType = cell?.dataValidation?.condition?.type;
      const values =
        cell?.dataValidation?.condition?.values?.map(
          (v) => v.userEnteredValue,
        ) || [];

      console.log(
        `  Col ${s.col} (${s.name}): dataValidation=${hasValidation} (Expected: true), values=[${values.join(', ')}]`,
      );

      if (!hasValidation || condType !== 'ONE_OF_LIST') {
        throw new Error(
          `Row ${rowNumber} Col ${s.col} (${s.name}) is missing ONE_OF_LIST data validation!`,
        );
      }

      // Check values match exactly
      if (
        values.length !== EXPECTED_CALL_STATUSES.length ||
        !EXPECTED_CALL_STATUSES.every((val, i) => values[i] === val)
      ) {
        throw new Error(
          `Row ${rowNumber} Col ${s.col} (${s.name}) options mismatch! Expected [${EXPECTED_CALL_STATUSES.join(', ')}], got [${values.join(', ')}]`,
        );
      }
    }

    // Remarks columns: N (13), Q (16), T (19)
    const remarksColIndices = [
      { name: '1st Call Remarks', col: 'N', idx: 13 },
      { name: '2nd Call Remarks', col: 'Q', idx: 16 },
      { name: '3rd Call Remarks', col: 'T', idx: 19 },
    ];

    for (const r of remarksColIndices) {
      const cell = rowCells[r.idx];
      const hasValidation = Boolean(cell?.dataValidation);
      const numberFormat = cell?.userEnteredFormat?.numberFormat?.type;
      console.log(
        `  Col ${r.col} (${r.name}): dataValidation=${hasValidation} (Expected: false), numberFormat=${numberFormat} (Expected: TEXT)`,
      );

      if (hasValidation) {
        throw new Error(
          `Row ${rowNumber} Col ${r.col} (${r.name}) MUST NOT have a data validation dropdown!`,
        );
      }
      if (numberFormat !== 'TEXT') {
        throw new Error(
          `Row ${rowNumber} Col ${r.col} (${r.name}) numberFormat must be TEXT, got ${numberFormat}`,
        );
      }
    }
  }

  // Verify candidate data preservation
  const valRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A1:Z5`,
  });
  const sheetRows = valRes.data.values || [];

  console.log('\n--- Checking Preserved Candidate Data ---');
  console.log(
    `Row 2 Candidate ID: ${sheetRows[1]?.[0]}, Name: "${sheetRows[1]?.[1]}", Status: "${sheetRows[1]?.[8]}"`,
  );
  console.log(
    `Row 3 Candidate ID: ${sheetRows[2]?.[0]}, Name: "${sheetRows[2]?.[1]}", Status: "${sheetRows[2]?.[8]}"`,
  );
  console.log(
    `Row 4 exists? ${sheetRows.length > 3 ? `Row 4 has data: ${JSON.stringify(sheetRows[3])}` : 'Row 4 is clean/empty (No orphaned rows)'}`,
  );

  if (sheetRows[1]?.[0] !== '1' || sheetRows[1]?.[1] !== 'Aastha Negi') {
    throw new Error('Candidate 1 data was modified or shifted!');
  }
  if (sheetRows[2]?.[0] !== '2' || sheetRows[2]?.[1] !== 'Abhishek Goud') {
    throw new Error('Candidate 2 data was modified or shifted!');
  }
  if (sheetRows.length > 3 && sheetRows[3]?.some((cell) => cell !== '')) {
    throw new Error(
      `Row 4 still contains stray/orphaned values: ${JSON.stringify(sheetRows[3])}`,
    );
  }

  console.log(
    '\n✅ ALL LIVE GOOGLE SHEETS VALIDATIONS AND FORMATS FULLY VERIFIED!',
  );
}

verifyLiveDropdowns().catch((err) => {
  console.error('\n❌ Verification check failed:', err.message);
  process.exit(1);
});
