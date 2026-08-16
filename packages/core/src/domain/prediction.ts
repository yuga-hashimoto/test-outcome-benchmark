import type { Revision } from './case';
import type { PredictionErrorKind, PredictionErrorRecord } from './errors';
import type { PredictedVerdict, Verdict } from './verdict';

export interface Evidence {
  readonly file: string;
  readonly location: string;
  readonly reason: string;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
}

export const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});

/**
 * Every timestamp the runner can observe. `firstTokenAt` and therefore `ttftMs`
 * are null on non-streaming responses; null is preserved rather than coerced to
 * zero so a partially instrumented run cannot read as a fast one.
 */
export interface LatencyMeasurement {
  readonly requestStartedAt: number;
  readonly firstTokenAt: number | null;
  readonly finalTokenAt: number | null;
  readonly parsedAt: number;
  readonly ttftMs: number | null;
  readonly generationMs: number | null;
  readonly modelLatencyMs: number | null;
  readonly endToEndMs: number;
}

/** What the model produced, once parsed against the output contract. */
export interface ParsedPrediction {
  readonly verdict: PredictedVerdict;
  readonly confidence: number | null;
  readonly reason: string;
  readonly evidence: readonly Evidence[];
  readonly requiresRuntimeInformation: boolean | null;
}

export interface PredictionRecord {
  readonly id: string;
  readonly runId: string;
  readonly caseId: string;
  readonly repetition: number;
  readonly goldVerdict: Verdict;
  readonly predictedVerdict: PredictedVerdict | null;
  readonly confidence: number | null;
  readonly reason: string | null;
  readonly evidence: readonly Evidence[];
  readonly requiresRuntimeInformation: boolean | null;
  readonly rawResponse: string;
  readonly usage: TokenUsage;
  readonly latency: LatencyMeasurement | null;
  readonly costUsd: number | null;
  readonly error: PredictionErrorRecord | null;
  readonly createdAt: string;
}

/** Values a run can be sliced by (spec §12). */
export type SliceValues = Readonly<Record<string, string | number | boolean | null>>;

/**
 * The scoring engine's input. Deliberately decoupled from storage: it is the
 * join of a prediction with the case facts that metrics need, and nothing else.
 */
export interface EvaluatedPrediction {
  readonly caseId: string;
  readonly repetition: number;
  /** PR identity, used to cluster bootstrap resamples (spec §13). */
  readonly clusterId: string;
  readonly goldVerdict: Verdict;
  readonly predictedVerdict: PredictedVerdict | null;
  readonly confidence: number | null;
  readonly errorKind: PredictionErrorKind | null;
  readonly latency: LatencyMeasurement | null;
  readonly usage: TokenUsage | null;
  readonly costUsd: number | null;
  readonly flipPairId: string | null;
  readonly revision: Revision;
  readonly slices: SliceValues;
}
