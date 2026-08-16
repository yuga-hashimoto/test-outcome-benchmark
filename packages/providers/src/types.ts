import type { InferenceSettings, ProviderId, TokenUsage } from '@tob/core';

/** Timestamps the adapter can observe. The runner derives the durations. */
export interface ResponseTiming {
  readonly requestStartedAt: number;
  /** Only observable when streaming; null otherwise, never faked. */
  readonly firstTokenAt: number | null;
  readonly finalTokenAt: number;
}

export interface ModelRequest {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly settings: InferenceSettings;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  /** Stable per (case, repetition); lets deterministic adapters reproduce. */
  readonly requestKey: string;
}

export interface ModelResponse {
  readonly text: string;
  readonly usage: TokenUsage;
  readonly timing: ResponseTiming;
}

/**
 * The whole surface a provider must implement. Everything above this interface
 * — scoring, retries, persistence — is provider-agnostic.
 */
export interface ModelAdapter {
  readonly provider: ProviderId;
  /** Provider-side ceiling the runner will not exceed regardless of its own setting. */
  readonly maxConcurrency: number;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface AdapterContext {
  readonly baseUrl: string | null;
  readonly apiKeyEnvVar: string | null;
  /** Reads the key by variable name at call time; the key is never persisted. */
  readonly readEnv: (name: string) => string | undefined;
}
