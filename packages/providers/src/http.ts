import { InfrastructureError, RequestTimeoutError } from '@tob/core';

/**
 * Status codes worth another attempt: rate limiting, timeouts, conflicts and
 * server faults. Everything else in the 4xx range reflects the request itself
 * and will fail the same way every time.
 */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export const isRetryableStatus = (status: number): boolean =>
  RETRYABLE_STATUSES.has(status) || status >= 500;

export interface JsonRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

export const requireApiKey = (
  envVar: string | null,
  readEnv: (name: string) => string | undefined,
  provider: string,
): string => {
  if (envVar === null) {
    throw new InfrastructureError(
      `${provider} requires an API key environment variable to be configured`,
      { code: 'MISSING_API_KEY_ENV', retryable: false },
    );
  }
  const value = readEnv(envVar);
  if (value === undefined || value.trim() === '') {
    throw new InfrastructureError(`Environment variable ${envVar} is not set`, {
      code: 'MISSING_API_KEY',
      retryable: false,
    });
  }
  return value;
};

/**
 * One JSON round trip with a timeout, mapping every transport outcome onto an
 * `InfrastructureError`. Response-body problems are the caller's business —
 * this layer never decides whether a model answered correctly.
 */
export const postJson = async (request: JsonRequest): Promise<unknown> => {
  const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
  const signal = AbortSignal.any([request.signal, timeoutSignal]);

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      signal,
    });
  } catch (error) {
    if (timeoutSignal.aborted) throw new RequestTimeoutError(request.timeoutMs);
    if (request.signal.aborted) throw error;
    throw new InfrastructureError(
      `Network error calling ${request.url}: ${error instanceof Error ? error.message : String(error)}`,
      { code: 'NETWORK', cause: error },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new InfrastructureError(
      `${response.status} ${response.statusText} from ${request.url}: ${body.slice(0, 500)}`,
      {
        status: response.status,
        code: String(response.status),
        retryable: isRetryableStatus(response.status),
      },
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new InfrastructureError('Provider returned a body that was not JSON', {
      status: response.status,
      code: 'MALFORMED_ENVELOPE',
      cause: error,
    });
  }
};

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

export const numberAt = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};
