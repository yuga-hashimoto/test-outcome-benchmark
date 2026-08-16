import { resolvedPredictions } from './confusion';
import { DEFAULT_THRESHOLDS } from './calibration';
import type { EvaluatedPrediction } from '../domain/prediction';

export interface SafeSkipPoint {
  readonly threshold: number;
  /** Predictions that would be skipped: predicted PASS at or above the threshold. */
  readonly skipped: number;
  readonly skipRate: number | null;
  /** Share of skipped tests that really did pass. */
  readonly safePassAccuracy: number | null;
  /** Tests that really failed and would have been skipped. The number that matters. */
  readonly missedFailures: number;
  readonly missedFailureRate: number | null;
}

export interface SafeSkipMetrics {
  readonly points: readonly SafeSkipPoint[];
  readonly resolved: number;
}

/**
 * Secondary analysis (spec §7): if a confident PASS prediction were used to
 * skip running a test, how much work is saved and what does it cost?
 *
 * `missedFailures` is reported as an absolute count, not only as a rate,
 * because that is the quantity a team actually absorbs — a 2% miss rate reads
 * as harmless until it is stated as "nine real failures shipped".
 */
export const computeSafeSkipMetrics = (
  predictions: readonly EvaluatedPrediction[],
  thresholds: readonly number[] = DEFAULT_THRESHOLDS,
): SafeSkipMetrics => {
  const resolved = resolvedPredictions(predictions);

  const points = thresholds.map((threshold): SafeSkipPoint => {
    const skipped = resolved.filter(
      (prediction) =>
        prediction.predictedVerdict === 'PASS' &&
        prediction.confidence !== null &&
        prediction.confidence >= threshold,
    );

    const trulyPassed = skipped.filter((prediction) => prediction.goldVerdict === 'PASS').length;
    const missedFailures = skipped.length - trulyPassed;

    return {
      threshold,
      skipped: skipped.length,
      skipRate: resolved.length === 0 ? null : skipped.length / resolved.length,
      safePassAccuracy: skipped.length === 0 ? null : trulyPassed / skipped.length,
      missedFailures,
      missedFailureRate: skipped.length === 0 ? null : missedFailures / skipped.length,
    };
  });

  return { points, resolved: resolved.length };
};
