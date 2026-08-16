import { CancelledError, isRetryableError } from '@tob/core';
import type { Rng } from '@tob/core';

export interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly signal: AbortSignal;
  readonly rng: Rng;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface RetryOutcome<T> {
  readonly value: T;
  readonly attempts: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries only what is worth retrying.
 *
 * `isRetryableError` is true for transient transport failures and false for
 * everything else — including output-contract violations, which are a result
 * the benchmark wants to record rather than an error to paper over. Retrying
 * those would systematically overstate how well a model follows the format.
 */
export const withRetry = async <T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<RetryOutcome<T>> => {
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;

  for (;;) {
    if (options.signal.aborted) throw new CancelledError();
    attempt += 1;

    try {
      return { value: await operation(attempt), attempts: attempt };
    } catch (error) {
      if (options.signal.aborted) throw new CancelledError();
      if (attempt >= options.maxAttempts || !isRetryableError(error)) throw error;

      const exponential = options.baseDelayMs * 2 ** (attempt - 1);
      /** Full jitter, seeded, so a retry storm stays reproducible in tests. */
      const delay = Math.min(options.maxDelayMs, exponential) * options.rng.next();
      await sleep(delay);
    }
  }
};
