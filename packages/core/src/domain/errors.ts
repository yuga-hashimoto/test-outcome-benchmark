export const PREDICTION_ERROR_KINDS = [
  'INFRASTRUCTURE',
  'OUTPUT_CONTRACT',
  'TIMEOUT',
  'CANCELLED',
] as const;
export type PredictionErrorKind = (typeof PREDICTION_ERROR_KINDS)[number];

export interface PredictionErrorRecord {
  readonly kind: PredictionErrorKind;
  readonly code: string | null;
  readonly message: string;
  readonly attempts: number;
}

/**
 * A failure of the transport, not of the model. Retrying is meaningful, and a
 * successful retry leaves no trace in the metrics.
 */
export class InfrastructureError extends Error {
  readonly kind: PredictionErrorKind = 'INFRASTRUCTURE';
  /**
   * Not every transport failure is worth retrying. A 429 or a 503 is transient;
   * a 400 or a 401 will fail identically on every attempt, and retrying it
   * spends the user's quota to reach the same answer more slowly.
   */
  readonly retryable: boolean;
  readonly status: number | null;
  readonly code: string | null;

  constructor(
    message: string,
    options: {
      status?: number | null;
      code?: string | null;
      cause?: unknown;
      retryable?: boolean;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'InfrastructureError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.retryable = options.retryable ?? true;
  }
}

export class RequestTimeoutError extends InfrastructureError {
  override readonly kind: PredictionErrorKind = 'TIMEOUT';

  constructor(timeoutMs: number) {
    super(`Request exceeded ${timeoutMs}ms`, { code: 'TIMEOUT' });
    this.name = 'RequestTimeoutError';
  }
}

export class CancelledError extends Error {
  readonly kind: PredictionErrorKind = 'CANCELLED';
  readonly retryable = false;

  constructor(message = 'Run was cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

/**
 * The model answered, but not in the contract. This is a benchmark result, not
 * an outage: retrying it as if it were infrastructure would quietly inflate the
 * measured accuracy of a model that cannot follow the output format.
 */
export class OutputContractViolation extends Error {
  readonly kind: PredictionErrorKind = 'OUTPUT_CONTRACT';
  readonly retryable = false;
  readonly rawResponse: string;
  readonly code: string;

  constructor(message: string, options: { rawResponse: string; code?: string }) {
    super(message);
    this.name = 'OutputContractViolation';
    this.rawResponse = options.rawResponse;
    this.code = options.code ?? 'OUTPUT_CONTRACT';
  }
}

export const isRetryableError = (error: unknown): boolean =>
  error instanceof InfrastructureError && error.retryable;

/** Maps any thrown value onto the persisted error shape. */
export const toErrorRecord = (error: unknown, attempts: number): PredictionErrorRecord => {
  if (error instanceof OutputContractViolation) {
    return { kind: error.kind, code: error.code, message: error.message, attempts };
  }
  if (error instanceof InfrastructureError) {
    return { kind: error.kind, code: error.code, message: error.message, attempts };
  }
  if (error instanceof CancelledError) {
    return { kind: error.kind, code: 'CANCELLED', message: error.message, attempts };
  }
  return {
    kind: 'INFRASTRUCTURE',
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    attempts,
  };
};
