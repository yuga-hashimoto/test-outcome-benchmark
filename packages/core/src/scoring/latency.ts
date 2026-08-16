import type { EvaluatedPrediction } from '../domain/prediction';

export interface LatencyStats {
  /** Sample size. Always reported: a percentile over three requests is not a percentile. */
  readonly count: number;
  readonly mean: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly p50: number | null;
  readonly p90: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
}

export interface LatencyMetrics {
  readonly endToEnd: LatencyStats;
  readonly modelLatency: LatencyStats;
  /** Null on non-streaming responses; those samples are excluded, not zeroed. */
  readonly timeToFirstToken: LatencyStats;
  readonly generation: LatencyStats;
  readonly testsPerMinute: number | null;
  readonly wallClockMs: number | null;
}

export const emptyLatencyStats = (): LatencyStats => ({
  count: 0,
  mean: null,
  min: null,
  max: null,
  p50: null,
  p90: null,
  p95: null,
  p99: null,
});

/**
 * Linear interpolation between closest ranks, matching the convention used by
 * numpy and most observability tooling, so numbers here line up with numbers
 * elsewhere.
 */
export const percentile = (sortedValues: readonly number[], fraction: number): number | null => {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0] as number;

  const rank = fraction * (sortedValues.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sortedValues[lowerIndex] as number;
  const upper = sortedValues[upperIndex] as number;

  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (rank - lowerIndex);
};

export const summarize = (values: readonly number[]): LatencyStats => {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return emptyLatencyStats();

  return {
    count: sorted.length,
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
};

const collect = (
  predictions: readonly EvaluatedPrediction[],
  select: (latency: NonNullable<EvaluatedPrediction['latency']>) => number | null,
): number[] => {
  const values: number[] = [];
  for (const prediction of predictions) {
    if (prediction.latency === null) continue;
    const value = select(prediction.latency);
    if (value === null || !Number.isFinite(value)) continue;
    values.push(value);
  }
  return values;
};

export const computeLatencyMetrics = (
  predictions: readonly EvaluatedPrediction[],
  wallClockMs: number | null = null,
): LatencyMetrics => {
  const endToEndValues = collect(predictions, (latency) => latency.endToEndMs);
  const measured = endToEndValues.length;

  const throughputBasisMs =
    wallClockMs ?? (measured === 0 ? null : endToEndValues.reduce((a, b) => a + b, 0));

  return {
    endToEnd: summarize(endToEndValues),
    modelLatency: summarize(collect(predictions, (latency) => latency.modelLatencyMs)),
    timeToFirstToken: summarize(collect(predictions, (latency) => latency.ttftMs)),
    generation: summarize(collect(predictions, (latency) => latency.generationMs)),
    testsPerMinute:
      throughputBasisMs === null || throughputBasisMs === 0
        ? null
        : (measured / throughputBasisMs) * 60_000,
    wallClockMs,
  };
};
