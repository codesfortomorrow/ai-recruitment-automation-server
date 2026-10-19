/**
 * Gemini API error classifier and backoff strategy calculator.
 * Distinguishes transient errors (503, 429, 500, 502, 504, timeouts, connection resets)
 * from permanent errors (invalid API key, 401, 403, 404, 400 bad request, safety filters).
 */

export class GeminiTransientException extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly retryAfterMs?: number;
  public readonly isTransient = true;

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      retryAfterMs?: number;
      cause?: any;
    },
  ) {
    super(message);
    this.name = 'GeminiTransientException';
    this.status = options?.status;
    this.code = options?.code;
    this.retryAfterMs = options?.retryAfterMs;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export class GeminiPermanentException extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly isPermanent = true;

  constructor(
    message: string,
    options?: { status?: number; code?: string; cause?: any },
  ) {
    super(message);
    this.name = 'GeminiPermanentException';
    this.status = options?.status;
    this.code = options?.code;
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

export interface ClassifiedGeminiError {
  isTransient: boolean;
  isPermanent: boolean;
  status?: number;
  code?: string;
  retryAfterMs?: number;
  reason: string;
}

/**
 * Extracts Retry-After duration in milliseconds from standard HTTP headers,
 * Google RPC error details, or error message patterns.
 */
export function extractRetryAfterMs(err: any): number | null {
  if (!err) return null;

  // 1. Check response headers (Axios / Fetch)
  const headers = err.response?.headers || err.headers || {};
  const retryAfterHeader =
    headers['retry-after'] ||
    headers['Retry-After'] ||
    headers['x-retry-after'];

  if (retryAfterHeader) {
    // If integer / numeric string representing seconds
    const seconds = parseFloat(String(retryAfterHeader).trim());
    if (!isNaN(seconds) && seconds > 0) {
      return Math.round(seconds * 1000);
    }

    // If HTTP date format (e.g., "Wed, 21 Oct 2026 07:28:00 GMT")
    const parsedDate = Date.parse(String(retryAfterHeader));
    if (!isNaN(parsedDate)) {
      const diffMs = parsedDate - Date.now();
      if (diffMs > 0) {
        return diffMs;
      }
    }
  }

  // 2. Check Google RPC statusDetails: { '@type': '...RetryInfo', retryDelay: '5s' }
  const statusDetails =
    err.statusDetails || err.errorDetails || err.response?.data?.error?.details;
  if (Array.isArray(statusDetails)) {
    for (const detail of statusDetails) {
      if (
        detail?.['@type']?.includes('RetryInfo') ||
        detail?.retryDelay !== undefined
      ) {
        const delayStr = String(detail.retryDelay || '').trim();
        const secMatch = delayStr.match(/^([0-9]+(?:\.[0-9]+)?)\s*s$/i);
        if (secMatch) {
          const s = parseFloat(secMatch[1]);
          if (!isNaN(s) && s > 0) {
            return Math.round(s * 1000);
          }
        }
      }
    }
  }

  // 3. Check error message patterns: e.g. "retry after 15s" or "ResourceExhausted: retry in 20.5s"
  const msg = String(err.message || '');
  const patternMatch = msg.match(
    /retry\s*(?:after|in)\s*([0-9]+(?:\.[0-9]+)?)\s*s/i,
  );
  if (patternMatch) {
    const s = parseFloat(patternMatch[1]);
    if (!isNaN(s) && s > 0) {
      return Math.round(s * 1000);
    }
  }

  return null;
}

/**
 * Classifies an error received from Google Gemini API into transient vs permanent.
 */
export function classifyGeminiError(err: any): ClassifiedGeminiError {
  if (!err) {
    return {
      isTransient: false,
      isPermanent: true,
      reason: 'Unknown empty error',
    };
  }

  // If already typed exception:
  if (err instanceof GeminiTransientException) {
    return {
      isTransient: true,
      isPermanent: false,
      status: err.status,
      code: err.code,
      retryAfterMs: err.retryAfterMs,
      reason: err.message,
    };
  }
  if (err instanceof GeminiPermanentException) {
    return {
      isTransient: false,
      isPermanent: true,
      status: err.status,
      code: err.code,
      reason: err.message,
    };
  }

  const rawStatus =
    err.status ||
    err.statusCode ||
    err.response?.status ||
    err.response?.statusCode;
  const status = typeof rawStatus === 'number' ? rawStatus : undefined;
  const code = err.code || err.statusText || err.response?.data?.error?.status;
  const rawMsg = err.message || err.response?.data?.error?.message || '';
  const lowerMsg = String(rawMsg).toLowerCase();
  const retryAfterMs = extractRetryAfterMs(err) || undefined;

  // 1. Permanent: Authentication & API key errors (HTTP 401 or message match)
  const isAuthError =
    status === 401 ||
    lowerMsg.includes('api key not valid') ||
    lowerMsg.includes('api_key_invalid') ||
    lowerMsg.includes('invalid api key') ||
    lowerMsg.includes('unauthenticated') ||
    lowerMsg.includes('gemini_api_key is missing');

  if (isAuthError) {
    return {
      isTransient: false,
      isPermanent: true,
      status: status || 401,
      code: code || 'UNAUTHENTICATED',
      reason: `Google Gemini API authentication failed: ${rawMsg || 'Invalid or missing API key'}`,
    };
  }

  // 2. Permanent: Permission Denied (HTTP 403)
  if (status === 403) {
    return {
      isTransient: false,
      isPermanent: true,
      status: 403,
      code: code || 'PERMISSION_DENIED',
      reason: `Google Gemini permission denied (HTTP 403): ${rawMsg}`,
    };
  }

  // 3. Permanent: Model Not Found or Unsupported (HTTP 404)
  const isNotFoundError =
    status === 404 ||
    lowerMsg.includes('not found') ||
    lowerMsg.includes('is not supported') ||
    lowerMsg.includes('unknown model') ||
    lowerMsg.includes('model not found');

  if (isNotFoundError) {
    return {
      isTransient: false,
      isPermanent: true,
      status: status || 404,
      code: code || 'NOT_FOUND',
      reason: `Google Gemini model/resource not found (HTTP 404): ${rawMsg}`,
    };
  }

  // 4. Permanent: Safety Filter Blocks
  const isSafetyBlock =
    lowerMsg.includes('safety') ||
    lowerMsg.includes('blocked by safety') ||
    lowerMsg.includes('finishreason: safety');

  if (isSafetyBlock) {
    return {
      isTransient: false,
      isPermanent: true,
      code: 'SAFETY_BLOCKED',
      reason: `Google Gemini response blocked by safety filters: ${rawMsg}`,
    };
  }

  // 5. Permanent: Bad Request (HTTP 400) - e.g., malformed JSON schema, invalid argument
  if (status === 400 && !lowerMsg.includes('transient')) {
    return {
      isTransient: false,
      isPermanent: true,
      status: 400,
      code: code || 'INVALID_ARGUMENT',
      reason: `Google Gemini bad request (HTTP 400): ${rawMsg}`,
    };
  }

  // 6. Transient: 503 Unavailable / High Demand
  const is503 =
    status === 503 ||
    lowerMsg.includes('503') ||
    lowerMsg.includes('unavailable') ||
    lowerMsg.includes('high demand') ||
    lowerMsg.includes('server is temporarily overloaded') ||
    lowerMsg.includes('overloaded');

  if (is503) {
    return {
      isTransient: true,
      isPermanent: false,
      status: 503,
      code: code || 'UNAVAILABLE',
      retryAfterMs,
      reason: `Google Gemini unavailable / high demand (HTTP 503): ${rawMsg}`,
    };
  }

  // 7. Transient: 429 Rate Limits / Resource Exhausted
  const is429 =
    status === 429 ||
    lowerMsg.includes('429') ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('too many requests') ||
    lowerMsg.includes('resource_exhausted') ||
    lowerMsg.includes('quota exceeded');

  if (is429) {
    return {
      isTransient: true,
      isPermanent: false,
      status: 429,
      code: code || 'RESOURCE_EXHAUSTED',
      retryAfterMs,
      reason: `Google Gemini rate limit / resource exhausted (HTTP 429): ${rawMsg}`,
    };
  }

  // 8. Transient: Server Errors (500, 502, 504)
  const isOtherServerError =
    typeof status === 'number' &&
    status >= 500 &&
    status <= 599 &&
    status !== 503;

  if (isOtherServerError) {
    return {
      isTransient: true,
      isPermanent: false,
      status,
      code: code || 'INTERNAL',
      retryAfterMs,
      reason: `Google Gemini server error (HTTP ${status}): ${rawMsg}`,
    };
  }

  // 9. Transient: Timeouts and Network Errors
  const isNetworkOrTimeout =
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('deadline exceeded') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('socket hang up') ||
    lowerMsg.includes('eai_again') ||
    err.code === 'ECONNABORTED' ||
    err.code === 'ETIMEDOUT' ||
    err.code === 'ECONNRESET';

  if (isNetworkOrTimeout) {
    return {
      isTransient: true,
      isPermanent: false,
      status: status || 504,
      code: code || 'DEADLINE_EXCEEDED',
      retryAfterMs,
      reason: `Google Gemini network or timeout error: ${rawMsg || err.code}`,
    };
  }

  // Default fallback: If status is unknown, consider it a transient error if it mentions temporary/server issues, else permanent
  return {
    isTransient: true,
    isPermanent: false,
    status,
    code,
    retryAfterMs,
    reason: `Google Gemini unexpected error: ${rawMsg}`,
  };
}

/**
 * Calculates exponential backoff with jitter.
 * Formula: min(maxDelay, initialDelay * 2^(attempt - 1)) * (0.5 + 0.5 * random)
 * Respects Retry-After header when present.
 */
export function calculateBackoffWithJitter(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  retryAfterMs?: number | null,
): number {
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return Math.min(Math.round(retryAfterMs), maxDelayMs);
  }

  const effectiveAttempt = Math.max(1, attempt);
  const exponential =
    initialDelayMs * Math.pow(2, Math.min(effectiveAttempt - 1, 10));
  const capped = Math.min(exponential, maxDelayMs);

  // Full jitter: between 50% and 100% of the computed backoff window
  const jitterFactor = 0.5 + Math.random() * 0.5;
  return Math.max(100, Math.round(capped * jitterFactor));
}
