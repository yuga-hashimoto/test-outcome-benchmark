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
import type { PredictionMode } from '../domain/verdict';
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
  /**
   * The headline number, and its definition depends on the run's prediction
   * mode. In FORCED mode the model was required to commit to a verdict, so
   * failing to produce one validly is a wrong answer: accuracy = correct ÷
   * attempted, identical to `strictAccuracy`. In SELECTIVE mode abstaining is
   * a legitimate choice, so accuracy = correct ÷ resolved, and `selective`
   * carries coverage as a separate, explicit number rather than folding it
   * into this one. Either way, a configuration cannot climb the leaderboard by
   * quietly failing to answer the cases it finds hard.
   */
  readonly accuracy: number | null;
  /** Correct ÷ attempted, counting abstentions and malformed output as wrong,
   * regardless of mode. In FORCED mode this equals `accuracy`. */
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
  /**
   * Required rather than defaulted: which denominator the headline `accuracy`
   * uses is exactly the thing a silent default would get wrong for someone
   * who forgot to think about it.
   */
  readonly predictionMode: PredictionMode;
  readonly seed?: number | string;
  readonly bootstrapResamples?: number;
  readonly wallClockMs?: number | null;
}

/**
 * Composes every metric from one list of predictions.
 *
 * `accuracy` and `strictAccuracy` are always produced together, and in FORCED
 * mode they are the same number. Reporting only a resolved-denominator
 * accuracy in FORCED mode would let a configuration climb the leaderboard by
 * emitting malformed JSON on the cases it finds hard — the failure is scored
 * as if it never happened rather than as the wrong answer it functionally is.
 */
export const aggregateRunMetrics = (
  predictions: readonly EvaluatedPrediction[],
  options: AggregateOptions,
): RunMetrics => {
  const seed = options.seed ?? 'aggregate';
  const isForced = options.predictionMode === 'FORCED';
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

  const strictAccuracy = predictions.length === 0 ? null : correct / predictions.length;

  return {
    counts,
    accuracy: isForced
      ? strictAccuracy
      : resolved.length === 0
        ? null
        : correct / resolved.length,
    strictAccuracy,
    accuracyInterval: clusterBootstrapAccuracy(predictions, {
      seed: `${seed}:accuracy`,
      strict: isForced,
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
