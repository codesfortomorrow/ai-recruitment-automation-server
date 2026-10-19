import {
  classifyGeminiError,
  calculateBackoffWithJitter,
  extractRetryAfterMs,
} from './gemini-error.classifier';

describe('GeminiErrorClassifier', () => {
  describe('extractRetryAfterMs', () => {
    it('should parse integer seconds from retry-after header', () => {
      const err = { response: { headers: { 'retry-after': '12' } } };
      expect(extractRetryAfterMs(err)).toBe(12000);
    });

    it('should parse Google RPC RetryInfo format', () => {
      const err = {
        statusDetails: [
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '7.5s',
          },
        ],
      };
      expect(extractRetryAfterMs(err)).toBe(7500);
    });

    it('should parse error message pattern for retry in seconds', () => {
      const err = { message: 'Rate limit exceeded. Please retry after 15s' };
      expect(extractRetryAfterMs(err)).toBe(15000);
    });

    it('should return null when no retry-after signal is present', () => {
      const err = { message: 'Some generic error' };
      expect(extractRetryAfterMs(err)).toBeNull();
    });
  });

  describe('classifyGeminiError', () => {
    it('should classify 503 UNAVAILABLE as transient', () => {
      const err = {
        status: 503,
        message: 'The model is overloaded. Please try again later.',
      };
      const result = classifyGeminiError(err);
      expect(result.isTransient).toBe(true);
      expect(result.isPermanent).toBe(false);
      expect(result.status).toBe(503);
    });

    it('should classify 429 Too Many Requests as transient and capture retry-after', () => {
      const err = {
        status: 429,
        message: 'Resource has been exhausted (check quota)',
        response: { headers: { 'retry-after': '30' } },
      };
      const result = classifyGeminiError(err);
      expect(result.isTransient).toBe(true);
      expect(result.isPermanent).toBe(false);
      expect(result.status).toBe(429);
      expect(result.retryAfterMs).toBe(30000);
    });

    it('should classify 500, 502, 504 as transient', () => {
      [500, 502, 504].forEach((status) => {
        const result = classifyGeminiError({
          status,
          message: 'Server error',
        });
        expect(result.isTransient).toBe(true);
        expect(result.isPermanent).toBe(false);
      });
    });

    it('should classify network timeouts as transient', () => {
      const err = { code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' };
      const result = classifyGeminiError(err);
      expect(result.isTransient).toBe(true);
      expect(result.isPermanent).toBe(false);
    });

    it('should classify invalid API key (401) as permanent', () => {
      const err = {
        status: 401,
        message: 'API key not valid. Please pass a valid API key.',
      };
      const result = classifyGeminiError(err);
      expect(result.isPermanent).toBe(true);
      expect(result.isTransient).toBe(false);
      expect(result.status).toBe(401);
    });

    it('should classify permission denied (403) as permanent', () => {
      const err = {
        status: 403,
        message: 'Permission denied on resource',
      };
      const result = classifyGeminiError(err);
      expect(result.isPermanent).toBe(true);
      expect(result.isTransient).toBe(false);
    });

    it('should classify model not found (404) as permanent', () => {
      const err = {
        status: 404,
        message: 'models/unknown-model is not found',
      };
      const result = classifyGeminiError(err);
      expect(result.isPermanent).toBe(true);
      expect(result.isTransient).toBe(false);
    });

    it('should classify bad request (400) as permanent', () => {
      const err = {
        status: 400,
        message: 'Invalid JSON schema payload provided',
      };
      const result = classifyGeminiError(err);
      expect(result.isPermanent).toBe(true);
      expect(result.isTransient).toBe(false);
    });

    it('should classify safety filter block as permanent', () => {
      const err = {
        message: 'Google Gemini response blocked by safety filters',
      };
      const result = classifyGeminiError(err);
      expect(result.isPermanent).toBe(true);
      expect(result.isTransient).toBe(false);
    });
  });

  describe('calculateBackoffWithJitter', () => {
    it('should use retryAfterMs when provided', () => {
      const delay = calculateBackoffWithJitter(1, 2000, 60000, 15000);
      expect(delay).toBe(15000);
    });

    it('should cap retryAfterMs at maxDelayMs', () => {
      const delay = calculateBackoffWithJitter(1, 2000, 30000, 90000);
      expect(delay).toBe(30000);
    });

    it('should compute exponential backoff with jitter within expected bounds', () => {
      const initialDelay = 1000;
      const maxDelay = 10000;

      // Attempt 1: base = 1000, jitter = [500, 1000]
      const delay1 = calculateBackoffWithJitter(1, initialDelay, maxDelay);
      expect(delay1).toBeGreaterThanOrEqual(500);
      expect(delay1).toBeLessThanOrEqual(1000);

      // Attempt 3: base = 4000, jitter = [2000, 4000]
      const delay3 = calculateBackoffWithJitter(3, initialDelay, maxDelay);
      expect(delay3).toBeGreaterThanOrEqual(2000);
      expect(delay3).toBeLessThanOrEqual(4000);

      // High attempt: capped at maxDelay = 10000, jitter = [5000, 10000]
      const delay10 = calculateBackoffWithJitter(10, initialDelay, maxDelay);
      expect(delay10).toBeGreaterThanOrEqual(5000);
      expect(delay10).toBeLessThanOrEqual(10000);
    });
  });
});
