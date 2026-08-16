import { buildConfusionMatrix, correctCount, falsePassCount, resolvedPredictions } from './confusion';
import { clusterBootstrapAccuracy } from './stats';
import { computeBaselines } from './baselines';
import { computeCalibrationMetrics } from './calibration';
import { computeCostMetrics } from './cost';
import { computeFlipPairMetrics } from './flip-pairs';
import { computeLatencyMetrics } from './latency';
import { computeSafeSkipMetrics } from './safe-skip';
import { computeSelectiveMetrics } from './selective';
import { computeSlices } from './slices';
import { computeStabilityMetrics } from './stability';
import type { BaselineMetrics } from './baselines';
import type { CalibrationMetrics } from './calibration';
import type { ClassificationMetrics } from './classification';
import type { ConfidenceInterval } from './stats';
import type { ConfusionMatrix } from './confusion';
import type { CostMetrics } from './cost';
import type { EvaluatedPrediction } from '../domain/prediction';
import type { FlipPairMetrics } from './flip-pairs';
import type { LatencyMetrics } from './latency';
import type { SafeSkipMetrics } from './safe-skip';
import type { SelectiveMetrics } from './selective';
import type { SliceDimension } from './slices';
import type { StabilityMetrics } from './stability';
import { computeClassificationMetrics } from './classification';

export interface PredictionCounts {
  readonly attempted: number;
  readonly resolved: number;
  readonly abstained: number;
  readonly contractViolations: number;
  readonly infrastructureErrors: number;
  readonly correct: number;
  readonly falsePass: number;
}

export interface RunMetrics {
  readonly counts: PredictionCounts;
  /** Correct ÷ resolved. The headline number. */
  readonly accuracy: number | null;
  /** Correct ÷ attempted, counting abstentions and malformed output as wrong. */
  readonly strictAccuracy: number | null;
  readonly accuracyInterval: ConfidenceInterval;
  readonly confusionMatrix: ConfusionMatrix;
  readonly classification: ClassificationMetrics;
  readonly baselines: BaselineMetrics;
  readonly calibration: CalibrationMetrics;
  readonly selective: SelectiveMetrics;
  readonly stability: StabilityMetrics;
  readonly flipPairs: FlipPairMetrics;
  readonly latency: LatencyMetrics;
  readonly cost: CostMetrics;
  readonly safeSkip: SafeSkipMetrics;
  readonly slices: readonly SliceDimension[];
}

export interface AggregateOptions {
  readonly seed?: number | string;
  readonly bootstrapResamples?: number;
  readonly wallClockMs?: number | null;
}

/**
 * Composes every metric from one list of predictions.
 *
 * `accuracy` and `strictAccuracy` are always produced together. Reporting only
 * the first would let a configuration climb the leaderboard by abstaining or by
 * emitting malformed JSON on the cases it finds hard; reporting only the second
 * would conflate "wrong" with "did not answer".
 */
export const aggregateRunMetrics = (
  predictions: readonly EvaluatedPrediction[],
  options: AggregateOptions = {},
): RunMetrics => {
  const seed = options.seed ?? 'aggregate';
  const matrix = buildConfusionMatrix(predictions);
  const resolved = resolvedPredictions(predictions);
  const correct = correctCount(matrix);

  const counts: PredictionCounts = {
    attempted: predictions.length,
    resolved: resolved.length,
    abstained: predictions.filter((prediction) => prediction.predictedVerdict === 'UNKNOWN').length,
    contractViolations: predictions.filter(
      (prediction) => prediction.errorKind === 'OUTPUT_CONTRACT',
    ).length,
    infrastructureErrors: predictions.filter(
      (prediction) =>
        prediction.errorKind === 'INFRASTRUCTURE' ||
        prediction.errorKind === 'TIMEOUT' ||
        prediction.errorKind === 'CANCELLED',
    ).length,
    correct,
    falsePass: falsePassCount(matrix),
  };

  return {
    counts,
    accuracy: resolved.length === 0 ? null : correct / resolved.length,
    strictAccuracy: predictions.length === 0 ? null : correct / predictions.length,
    accuracyInterval: clusterBootstrapAccuracy(predictions, {
      seed: `${seed}:accuracy`,
      ...(options.bootstrapResamples !== undefined
        ? { resamples: options.bootstrapResamples }
        : {}),
    }),
    confusionMatrix: matrix,
    classification: computeClassificationMetrics(matrix),
    baselines: computeBaselines(predictions, seed),
    calibration: computeCalibrationMetrics(predictions),
    selective: computeSelectiveMetrics(predictions),
    stability: computeStabilityMetrics(predictions),
    flipPairs: computeFlipPairMetrics(predictions),
    latency: computeLatencyMetrics(predictions, options.wallClockMs ?? null),
    cost: computeCostMetrics(predictions),
    safeSkip: computeSafeSkipMetrics(predictions),
    slices: computeSlices(predictions),
  };
};
