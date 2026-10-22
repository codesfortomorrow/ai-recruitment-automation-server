import { registerAs } from '@nestjs/config';

/**
 * "Sign in with Slack" (OAuth 2.0 / identity API) config.
 * `allowedTeamId` is what restricts login to a single workspace: any Slack
 * account can complete the OAuth dance, but SlackStrategy rejects the login
 * if the returned team.id doesn't match this value.
 */
export const slackConfigFactory = registerAs('slack', () => ({
  oauth: {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    scope: [
      'identity.basic',
      'identity.email',
      'identity.avatar',
      'identity.team',
    ],
  },
  allowedTeamId: process.env.SLACK_ALLOWED_TEAM_ID,
  // Events API request signing (used to verify POST /slack/events).
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // Bot token (xoxb-...) used for conversations.history / conversations.replies.
  botToken: process.env.SLACK_BOT_TOKEN,
  attendance: {
    channelId: process.env.SLACK_ATTENDANCE_CHANNEL_ID,
    // IANA zone in which employees type their HH:mm timesheet times.
    timezone: process.env.ATTENDANCE_TIMEZONE || 'Asia/Kolkata',
    // Backend attendance validation of timesheet entries. Off until enabled.
    validationEnabled: process.env.ATTENDANCE_VALIDATION_ENABLED === 'true',
    // Optional YYYY-MM-DD: days before this date are never validated.
    enforceFromDate: process.env.ATTENDANCE_ENFORCE_FROM_DATE || undefined,
    // Mandatory attendance per day (lunch/breaks included, never deducted).
    requiredMinutes: 9 * 60,
  },
}));
