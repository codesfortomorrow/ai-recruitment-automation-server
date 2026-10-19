import { registerAs } from '@nestjs/config';

export const geminiConfigFactory = registerAs('gemini', () => ({
  apiKey: process.env.GEMINI_API_KEY || '',
  model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  maxRetries: parseInt(process.env.GEMINI_MAX_RETRIES || '2', 10),
  timeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS || '60000', 10),
  temperature: parseFloat(process.env.GEMINI_TEMPERATURE || '0'),
  maxOutputTokens: parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '4096', 10),

  // Durable retry configuration
  initialRetryDelayMs: parseInt(
    process.env.GEMINI_INITIAL_RETRY_DELAY_MS || '2000',
    10,
  ),
  maxRetryDelayMs: parseInt(
    process.env.GEMINI_MAX_RETRY_DELAY_MS || '60000',
    10,
  ),
  maxAttempts: parseInt(process.env.GEMINI_MAX_ATTEMPTS || '5', 10),
  maxRetryAgeMs: parseInt(
    process.env.GEMINI_MAX_RETRY_AGE_MS || String(24 * 60 * 60 * 1000),
    10,
  ),
  retryWorkerIntervalMs: parseInt(
    process.env.GEMINI_RETRY_WORKER_INTERVAL_MS || '10000',
    10,
  ),
  maxConcurrentRequests: parseInt(
    process.env.GEMINI_MAX_CONCURRENT_REQUESTS || '2',
    10,
  ),
}));
