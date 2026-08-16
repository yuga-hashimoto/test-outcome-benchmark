import { isResolved } from '../domain/verdict';
import type { EvaluatedPrediction } from '../domain/prediction';
import type { Verdict } from '../domain/verdict';

/**
 * Cells are named by (gold, predicted) rather than by positive/negative,
 * because which class counts as "positive" differs between the PASS and FAIL
 * views and the ambiguity is a reliable source of sign errors.
 *
 * `goldFailPredictedPass` is the cell that matters operationally: a test that
 * really fails, predicted to pass.
 */
export interface ConfusionMatrix {
  readonly goldPassPredictedPass: number;
  readonly goldPassPredictedFail: number;
  readonly goldFailPredictedPass: number;
  readonly goldFailPredictedFail: number;
  readonly total: number;
}

export const emptyConfusionMatrix = (): ConfusionMatrix => ({
  goldPassPredictedPass: 0,
  goldPassPredictedFail: 0,
  goldFailPredictedPass: 0,
  goldFailPredictedFail: 0,
  total: 0,
});

/** Predictions that resolved to PASS or FAIL, i.e. can be placed in the matrix. */
export const resolvedPredictions = (
  predictions: readonly EvaluatedPrediction[],
): readonly (EvaluatedPrediction & { predictedVerdict: Verdict })[] =>
  predictions.filter(
    (prediction): prediction is EvaluatedPrediction & { predictedVerdict: Verdict } =>
      isResolved(prediction.predictedVerdict),
  );

export const buildConfusionMatrix = (
  predictions: readonly EvaluatedPrediction[],
): ConfusionMatrix => {
  let goldPassPredictedPass = 0;
  let goldPassPredictedFail = 0;
  let goldFailPredictedPass = 0;
  let goldFailPredictedFail = 0;

  for (const prediction of resolvedPredictions(predictions)) {
    if (prediction.goldVerdict === 'PASS') {
      if (prediction.predictedVerdict === 'PASS') goldPassPredictedPass += 1;
      else goldPassPredictedFail += 1;
    } else if (prediction.predictedVerdict === 'PASS') {
      goldFailPredictedPass += 1;
    } else {
      goldFailPredictedFail += 1;
    }
  }

  return {
    goldPassPredictedPass,
    goldPassPredictedFail,
    goldFailPredictedPass,
    goldFailPredictedFail,
    total:
      goldPassPredictedPass + goldPassPredictedFail + goldFailPredictedPass + goldFailPredictedFail,
  };
};

export const correctCount = (matrix: ConfusionMatrix): number =>
  matrix.goldPassPredictedPass + matrix.goldFailPredictedFail;

/** Tests that really fail but were predicted to pass — the costly error. */
export const falsePassCount = (matrix: ConfusionMatrix): number => matrix.goldFailPredictedPass;
