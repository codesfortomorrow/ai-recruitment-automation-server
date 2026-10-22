import { registerAs } from '@nestjs/config';
import { Environment } from '@Common';

export const appConfigFactory = registerAs('app', () => ({
  env: process.env.APP_ENV as Environment,
  domain: process.env.DOMAIN,
  appWebUrl: process.env.APP_WEB_URL || process.env.FRONTEND_URL,
  adminWebUrl: process.env.ADMIN_WEB_URL,
  frontendUrl: process.env.FRONTEND_URL || process.env.APP_WEB_URL,
  serverUrl: process.env.SERVER_URL,
  publicUrl: process.env.APP_PUBLIC_URL,
  appUri: process.env.APP_URI,
  httpPayloadMaxSize: '20mb',
  cacheTtl: 60000,
  name: process.env.APP_NAME,
  shortName: process.env.APP_SHORT_NAME,
}));
