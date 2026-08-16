import { resolvedPredictions } from './confusion';
import type { EvaluatedPrediction } from '../domain/prediction';

export interface SelectiveMetrics {
  /** Share of attempts where the model committed to PASS or FAIL. */
  readonly coverage: number | null;
  /** Accuracy over the covered subset only. */
  readonly selectiveAccuracy: number | null;
  /** Share of attempts answered UNKNOWN. */
  readonly abstentionRate: number | null;
  /** Share of attempts that produced no usable verdict for any reason. */
  readonly unresolvedRate: number | null;
  readonly attempted: number;
  readonly covered: number;
  readonly abstained: number;
}

/**
 * Selective prediction turns "I don't know" into a first-class answer. Coverage
 * and selective accuracy have to be read together: either one alone can be
 * driven to a flattering number by abstaining more or less.
 */
export const computeSelectiveMetrics = (
  predictions: readonly EvaluatedPrediction[],
): SelectiveMetrics => {
  const attempted = predictions.length;
  const covered = resolvedPredictions(predictions).length;
  const abstained = predictions.filter(
    (prediction) => prediction.predictedVerdict === 'UNKNOWN',
  ).length;

  const correct = resolvedPredictions(predictions).filter(
    (prediction) => prediction.predictedVerdict === prediction.goldVerdict,
  ).length;

  return {
    coverage: attempted === 0 ? null : covered / attempted,
    selectiveAccuracy: covered === 0 ? null : correct / covered,
    abstentionRate: attempted === 0 ? null : abstained / attempted,
    unresolvedRate: attempted === 0 ? null : (attempted - covered) / attempted,
    attempted,
    covered,
    abstained,
  };
};
