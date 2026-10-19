import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CandidateService } from '../src/candidate/candidate.service';
import { GoogleSheetsService } from '../src/candidate/google-sheets.service';

async function verifyLivePolling() {
  console.log(
    '=== Starting Controlled Live Google Sheets Polling Verification ===',
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const candidateService = app.get(CandidateService);
    const googleSheetsService = app.get(GoogleSheetsService);

    console.log('\nStep 1: Check Google Sheets Service Configuration');
    const isConfigured = googleSheetsService.isConfigured();
    const pollingConfig = googleSheetsService.getPollingConfig();
    console.log(`- Google Sheets Configured: ${isConfigured}`);
    console.log(`- Polling Enabled: ${pollingConfig.pollingEnabled}`);
    console.log(
      `- Polling Interval: ${pollingConfig.pollingIntervalMinutes} minutes`,
    );

    if (!isConfigured) {
      throw new Error('Google Sheets is not configured!');
    }

    console.log('\nStep 2: Read baseline rows from Google Sheets');
    const initialRows = await googleSheetsService.readCandidateTrackerRows();
    console.log(
      `- Read ${initialRows.length} candidate rows from Google Sheets:`,
    );
    for (const row of initialRows) {
      console.log(
        `  Candidate ID ${row.candidateId}: ${row.candidateName} (${row.email}) | Call1: "${row.call1Status}" | Call2: "${row.call2Status}" | Call3: "${row.call3Status}"`,
      );
    }

    console.log('\nStep 3: Run baseline poll to synchronize initial hashes');
    const baselinePoll = await candidateService.pollGoogleSheetsForCallUpdates({
      triggerSource: 'MANUAL',
    });
    console.log(`- Baseline Poll Status: ${baselinePoll.status}`);
    console.log(`- Changed Candidates: ${baselinePoll.changedCandidatesCount}`);
    console.log(`- Emails Triggered: ${baselinePoll.emailsTriggeredCount}`);

    console.log(
      '\nStep 4: Perform controlled HR edit on Candidate 2 in Google Sheets',
    );
    // We update Candidate 2 (Abhishek Goud) Row 3:
    // Column M (1st Call Status) -> "Not Answered" (1st attempt, non-email triggering)
    // Column N (1st Call Remarks) -> "Live verification: HR attempted reach out"
    const client = googleSheetsService.getClient();
    if (!client) {
      throw new Error('Google Sheets client is null');
    }
    const tabName = 'Candidate Tracker';
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    // Row 3: M3:N3
    await client.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!M3:N3`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['Not Answered', 'Live verification: HR attempted reach out']],
      },
    });
    console.log(
      '- Successfully updated Column M3 to "Not Answered" and N3 to "Live verification: HR attempted reach out"',
    );

    console.log('\nStep 5: Run Google Sheets Poller to detect live sheet edit');
    const livePoll = await candidateService.pollGoogleSheetsForCallUpdates({
      triggerSource: 'SCHEDULED',
    });
    console.log(`- Live Poll Status: ${livePoll.status}`);
    console.log(
      `- Changed Candidates Count: ${livePoll.changedCandidatesCount}`,
    );
    console.log(`- Emails Triggered Count: ${livePoll.emailsTriggeredCount}`);
    console.log('- Details:', JSON.stringify(livePoll.details, null, 2));

    const cand2Detail = livePoll.details.find((d) => d.candidateId === 2);
    if (!cand2Detail || cand2Detail.action !== 'RECONCILED') {
      throw new Error(
        `Expected Candidate 2 to be RECONCILED, but got: ${JSON.stringify(cand2Detail)}`,
      );
    }

    console.log(
      '\nStep 6: Verify repeated poll skips candidate (no loop / no duplicate)',
    );
    const secondPoll = await candidateService.pollGoogleSheetsForCallUpdates({
      triggerSource: 'SCHEDULED',
    });
    console.log(`- Second Poll Status: ${secondPoll.status}`);
    console.log(
      `- Changed Candidates Count: ${secondPoll.changedCandidatesCount}`,
    );
    const cand2Second = secondPoll.details.find((d) => d.candidateId === 2);
    console.log(
      `- Candidate 2 Action on Second Poll: ${cand2Second?.action} (expected: UNCHANGED)`,
    );

    if (cand2Second?.action !== 'UNCHANGED') {
      throw new Error(
        `Expected UNCHANGED on repeated poll, but got: ${cand2Second?.action}`,
      );
    }

    console.log(
      '\nStep 7: Reset test candidate columns in Google Sheets to clean state',
    );
    await client.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!M3:N3`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['', '']],
      },
    });
    console.log('- Successfully restored M3:N3 to blank in Google Sheets');

    console.log('\n=== Controlled Live Verification PASSED Successfully! ===');
  } finally {
    await app.close();
  }
}

verifyLivePolling().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
