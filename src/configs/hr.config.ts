import { registerAs } from '@nestjs/config';

export interface HrMember {
  id: string;
  name: string;
  email: string;
}

export interface HrConfig {
  hr1: HrMember;
  hr2: HrMember;
  adminWebUrl?: string;
  appWebUrl?: string;
  appPublicUrl?: string;
  manualReviewEmail?: string;
}

export const hrConfigFactory = registerAs(
  'hr',
  (): HrConfig => ({
    hr1: {
      id: (process.env.HR1_ID || 'hr-1').trim(),
      name: (process.env.HR1_NAME || 'HR 1').trim(),
      email: (process.env.HR1_EMAIL || '').trim(),
    },
    hr2: {
      id: (process.env.HR2_ID || 'hr-2').trim(),
      name: (process.env.HR2_NAME || 'HR 2').trim(),
      email: (process.env.HR2_EMAIL || '').trim(),
    },
    adminWebUrl: process.env.ADMIN_WEB_URL,
    appWebUrl: process.env.APP_WEB_URL,
    appPublicUrl: process.env.APP_PUBLIC_URL,
    manualReviewEmail:
      (
        process.env.HR_MANUAL_REVIEW_EMAIL ||
        process.env.MANUAL_REVIEW_EMAIL ||
        ''
      ).trim() || undefined,
  }),
);
