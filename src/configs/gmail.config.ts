import { registerAs } from '@nestjs/config';

export const gmailConfigFactory = registerAs('gmail', () => ({
  user: process.env.GMAIL_USER || 'me',
  clientId: process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret:
    process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  searchQuery: process.env.GMAIL_SEARCH_QUERY || 'label:INBOX is:unread',
  pollingEnabled: process.env.GMAIL_POLLING_ENABLED === 'true',
  pollingCron: process.env.GMAIL_POLLING_CRON || '0 * * * * *',
  maxAttachmentSize:
    Number(process.env.GMAIL_MAX_ATTACHMENT_SIZE) || 10 * 1024 * 1024,
}));
