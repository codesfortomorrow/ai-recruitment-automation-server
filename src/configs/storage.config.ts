import { registerAs } from '@nestjs/config';

export const storageConfigFactory = registerAs('storage', () => ({
  diskDestination: process.env.STORAGE_DIR,
  url: process.env.STORAGE_URL,
  maxFileSize: 15000000, // 15000000 Bytes = 15 MB
  fileExtensions: ['.png', '.jpg', '.jpeg'],
}));
