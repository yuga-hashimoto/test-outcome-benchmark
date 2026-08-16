export const PROVIDER_IDS = [
  'mock',
  'openai',
  'anthropic',
  'gemini',
  'openai-compatible',
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface InferenceSettings {
  readonly temperature: number | null;
  readonly topP: number | null;
  readonly maxOutputTokens: number | null;
  readonly reasoningEffort: 'none' | 'low' | 'medium' | 'high' | null;
  readonly seed: number | null;
  /** Streaming is what makes TTFT observable; without it TTFT stays null. */
  readonly stream: boolean;
}

export const defaultInferenceSettings = (): InferenceSettings => ({
  temperature: 0,
  topP: null,
  maxOutputTokens: 2048,
  reasoningEffort: null,
  seed: null,
  stream: false,
});

/**
 * Prices are kept apart from results and snapshotted per run (spec §8), so
 * recomputing an old run's cost with today's prices is an explicit act rather
 * than an accident.
 */
export interface ModelPricing {
  readonly currency: 'USD';
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cachedInputPerMillion: number | null;
  readonly reasoningPerMillion: number | null;
  readonly source: string;
  readonly snapshotAt: string;
}

export interface ModelConfiguration {
  readonly id: string;
  readonly name: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly settings: InferenceSettings;
  readonly baseUrl: string | null;
  /** Name of the environment variable holding the key. Never the key itself. */
  readonly apiKeyEnvVar: string | null;
  readonly pricing: ModelPricing | null;
  readonly createdAt: string;
}
