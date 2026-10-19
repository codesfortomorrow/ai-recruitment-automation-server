/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');

// Load .env
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  });
}

async function inspectLiveSheet() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const keyFile = path.resolve(
    __dirname,
    '..',
    process.env.GOOGLE_SHEETS_KEY_FILE,
  );
  const tabName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Candidate Tracker';

  console.log(`Checking spreadsheetId: ${spreadsheetId}`);
  console.log(`KeyFile: ${keyFile}`);
  console.log(`TabName: ${tabName}`);

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties))',
  });

  console.log('\n--- Spreadsheet Metadata ---');
  for (const s of meta.data.sheets || []) {
    console.log(
      `Sheet title: "${s.properties?.title}", sheetId: ${s.properties?.sheetId}, rowCount: ${s.properties?.gridProperties?.rowCount}, colCount: ${s.properties?.gridProperties?.columnCount}`,
    );
  }

  const valuesRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A1:Z10`,
  });

  const rows = valuesRes.data.values || [];
  console.log('\n--- Current Rows in Sheet ---');
  console.log(`Total rows returned: ${rows.length}`);
  if (rows.length > 0) {
    console.log(`Headers (row 1) [${rows[0].length} columns]:`);
    rows[0].forEach((col, idx) => {
      const letter = String.fromCharCode(65 + idx);
      console.log(`  ${letter} (${idx + 1}): "${col}"`);
    });
    for (let i = 1; i < rows.length; i++) {
      console.log(`\nRow ${i + 1} [${rows[i].length} columns]:`);
      rows[i].forEach((col, idx) => {
        const letter = String.fromCharCode(65 + idx);
        console.log(`  ${letter} (${idx + 1}): "${col}"`);
      });
    }
  }
}

inspectLiveSheet().catch((err) => {
  console.error('Error inspecting live sheet:', err);
  process.exit(1);
});
