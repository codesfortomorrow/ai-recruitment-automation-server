import { registerAs } from '@nestjs/config';

export const authConfigFactory = registerAs('auth', () => ({
  authCookieExpirationTime: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
}));
