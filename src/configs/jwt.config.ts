import { registerAs } from '@nestjs/config';
import { StringValue } from 'ms';

export const jwtConfigFactory = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET,
  signOptions: { expiresIn: '24h' as StringValue },
}));
