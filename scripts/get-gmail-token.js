const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { google } = require('googleapis');

// Load environment variables from .env
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const clientId =
  process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret =
  process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const port = 3333;
const redirectUri = `http://localhost:${port}/callback`;

if (!clientId || !clientSecret) {
  console.error(
    'Error: GMAIL_CLIENT_ID (or GOOGLE_OAUTH_CLIENT_ID) and GMAIL_CLIENT_SECRET (or GOOGLE_OAUTH_CLIENT_SECRET) must be set in your .env file.',
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  redirectUri,
);

// Required scopes for Gmail ingestion, marking as read, and sending HR notifications
const scopes = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];

const loginHint =
  process.env.GMAIL_USER || 'abhishekgoud.mongoosetech@gmail.com';

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // Forces Google to issue a new refresh token
  scope: scopes,
  login_hint: loginHint !== 'me' ? loginHint : undefined,
});

console.log(
  '\n===============================================================',
);
console.log(' Gmail OAuth2 Re-Authorization Helper');
console.log('===============================================================');
console.log(`Target Email : ${loginHint}`);
console.log(`Redirect URI : ${redirectUri}`);
console.log('Requested Scopes:');
scopes.forEach((s) => console.log(` - ${s}`));
console.log('---------------------------------------------------------------');
console.log('\n1. Open the following authorization URL in your browser:');
console.log(`\n${authUrl}\n`);
console.log('2. Log in and grant permissions to your application.');
console.log('3. Google will redirect to http://localhost:3333/callback.');
console.log(`Waiting for authorization callback on port ${port}...\n`);

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/callback') {
      const code = parsedUrl.query.code;
      const error = parsedUrl.query.error;

      if (error) {
        console.error(`Authorization rejected by user or Google: ${error}`);
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(
          `<h2>Authorization Failed</h2><p>Google returned error: ${error}</p>`,
        );
        server.close();
        process.exit(1);
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(
          '<h2>Missing Authorization Code</h2><p>No "code" parameter found in callback query.</p>',
        );
        return;
      }

      // Exchange authorization code for tokens
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.refresh_token) {
        console.warn('\nWarning: Google did not return a new refresh token.');
        console.warn(
          'Reason: The consent prompt might have been skipped or an existing refresh token is already active.',
        );
        console.warn('Ensure prompt=consent is used.');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <div style="font-family: sans-serif; padding: 24px; text-align: center;">
            <h2 style="color: #d97706;">Authorization Received, but No Refresh Token Returned</h2>
            <p>Google did not return a refresh token. Try revoking app permissions in your Google Account security settings and re-running this script.</p>
          </div>
        `);
        server.close();
        process.exit(1);
        return;
      }

      // Automatically update .env file with the new refresh token safely
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        if (envContent.includes('GMAIL_REFRESH_TOKEN=')) {
          envContent = envContent.replace(
            /GMAIL_REFRESH_TOKEN=.*/,
            `GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`,
          );
        } else {
          envContent += `\nGMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`;
        }

        // Also ensure GMAIL_USER is set to target account if not set
        if (
          loginHint &&
          loginHint !== 'me' &&
          envContent.includes('GMAIL_USER=')
        ) {
          const currentUser = process.env.GMAIL_USER;
          if (!currentUser || currentUser === 'me') {
            envContent = envContent.replace(
              /GMAIL_USER=.*/,
              `GMAIL_USER=${loginHint}`,
            );
          }
        }

        fs.writeFileSync(envPath, envContent, 'utf8');
        console.log(
          '\n[SUCCESS] New Gmail refresh token acquired and automatically saved to .env!',
        );
      } else {
        console.log('\n[SUCCESS] New Gmail refresh token acquired!');
        console.log(
          'Please add it to your .env file as: GMAIL_REFRESH_TOKEN=<token>',
        );
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <div style="font-family: sans-serif; padding: 24px; text-align: center;">
          <h2 style="color: #16a34a;">Authorization Successful!</h2>
          <p>Your Gmail refresh token has been updated in <code>.env</code>.</p>
          <p>You can close this browser tab and return to the terminal.</p>
        </div>
      `);

      setTimeout(() => {
        server.close();
        console.log(
          'Server closed. You can now restart or test your NestJS application.\n',
        );
        process.exit(0);
      }, 1000);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  } catch (err) {
    console.error(`Error during token exchange: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h2>Token Exchange Error</h2><p>${err.message}</p>`);
    server.close();
    process.exit(1);
  }
});

server.listen(port, () => {
  // Server is running and listening on port 3333
});
