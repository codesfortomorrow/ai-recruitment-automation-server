import * as path from 'path';
import * as dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export async function verifyGoogleSheetsE2E() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const keyFile = process.env.GOOGLE_SHEETS_KEY_FILE;
  const tabName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Candidate Tracker';

  if (!spreadsheetId || !keyFile) {
    throw new Error(
      'GOOGLE_SHEETS_SPREADSHEET_ID or GOOGLE_SHEETS_KEY_FILE is not set',
    );
  }

  const resolvedKeyPath = path.isAbsolute(keyFile)
    ? keyFile
    : path.resolve(process.cwd(), keyFile);

  const auth = new google.auth.GoogleAuth({
    keyFile: resolvedKeyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  console.log('--- Verifying Google Sheets E2E Formatting ---');
  console.log(`Spreadsheet ID: ${spreadsheetId}`);
  console.log(`Tab Name: ${tabName}`);

  // 1. Fetch metadata and grid data for first 10 rows
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`'${tabName}'!A1:Q10`],
    includeGridData: true,
  });

  const sheet = res.data.sheets?.[0];
  if (!sheet) {
    throw new Error(`Worksheet "${tabName}" not found`);
  }

  const rows = sheet.data?.[0]?.rowData || [];
  console.log(`Retrieved ${rows.length} rows.`);

  // 2. Check Row 1 (Header Row)
  const headerRow = rows[0];
  const headerCell0 = headerRow?.values?.[0];
  const headerBg =
    headerCell0?.userEnteredFormat?.backgroundColor ||
    headerCell0?.effectiveFormat?.backgroundColor;
  const headerTextFmt =
    headerCell0?.userEnteredFormat?.textFormat ||
    headerCell0?.effectiveFormat?.textFormat;

  console.log('\n[Header Row 1 Check]');
  console.log('Header Background:', JSON.stringify(headerBg));
  console.log(
    'Header Text Format (bold, color):',
    JSON.stringify({
      bold: headerTextFmt?.bold,
      foregroundColor: headerTextFmt?.foregroundColor,
    }),
  );

  const isHeaderDarkBlue =
    headerBg &&
    headerBg.blue &&
    headerBg.blue > 0.4 &&
    headerBg.red &&
    headerBg.red < 0.3;

  if (!isHeaderDarkBlue) {
    console.warn(
      'WARNING: Row 1 header does not have expected dark blue background!',
    );
  } else {
    console.log(
      'PASS: Header Row 1 has expected dark blue background and white bold text.',
    );
  }

  // 3. Check Row 2 (Candidate Data Row)
  const candidateRow = rows[1];
  const candCell0 = candidateRow?.values?.[0];
  const candBg =
    candCell0?.userEnteredFormat?.backgroundColor ||
    candCell0?.effectiveFormat?.backgroundColor;
  const candTextFmt =
    candCell0?.userEnteredFormat?.textFormat ||
    candCell0?.effectiveFormat?.textFormat;

  console.log('\n[Candidate Row 2 Check]');
  console.log('Candidate Row Background:', JSON.stringify(candBg));
  console.log(
    'Candidate Row Text Format (bold, color):',
    JSON.stringify({
      bold: candTextFmt?.bold,
      foregroundColor: candTextFmt?.foregroundColor,
    }),
  );

  const isCandWhiteOrLight =
    !candBg ||
    (candBg.red === 1 && candBg.green === 1 && candBg.blue === 1) ||
    ((candBg.red ?? 0) > 0.9 &&
      (candBg.green ?? 0) > 0.9 &&
      (candBg.blue ?? 0) > 0.9);

  const isCandTextNotWhite =
    !candTextFmt?.foregroundColor ||
    candTextFmt.foregroundColor.red !== 1 ||
    candTextFmt.foregroundColor.green !== 1 ||
    candTextFmt.foregroundColor.blue !== 1;

  if (!isCandWhiteOrLight) {
    console.error(
      'FAIL: Candidate Row 2 has unwanted background color:',
      candBg,
    );
  } else {
    console.log('PASS: Candidate Row 2 has clean white/neutral background.');
  }

  if (candTextFmt?.bold === true) {
    console.error('FAIL: Candidate Row 2 text is bold!');
  } else {
    console.log('PASS: Candidate Row 2 text is not bold.');
  }

  // 4. Check Data Validations on Columns I (Col 9), J (Col 10), L (Col 12)
  console.log('\n[Data Validation Checks for Columns I, J, L]');
  const colI = candidateRow?.values?.[8];
  const colJ = candidateRow?.values?.[9];
  const colL = candidateRow?.values?.[11];

  console.log(
    'Col I (Application Status) validation:',
    colI?.dataValidation ? 'PRESENT' : 'MISSING',
  );
  console.log(
    'Col J (Current Interview Round) validation:',
    colJ?.dataValidation ? 'PRESENT' : 'MISSING',
  );
  console.log(
    'Col L (Last Call Status) validation:',
    colL?.dataValidation ? 'PRESENT' : 'MISSING',
  );

  const allValidationsPresent = Boolean(
    colI?.dataValidation && colJ?.dataValidation && colL?.dataValidation,
  );
  if (allValidationsPresent) {
    console.log(
      'PASS: All dropdown data validations are present on Candidate Row 2.',
    );
  } else {
    console.warn('WARNING: One or more data validations are missing on Row 2.');
  }

  console.log('\n--- E2E Verification Complete ---');
  return {
    isHeaderDarkBlue,
    isCandWhiteOrLight,
    isCandTextNotWhite,
    allValidationsPresent,
  };
}

if (require.main === module) {
  verifyGoogleSheetsE2E()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
