import { correctCount } from './confusion';
import type { ConfusionMatrix } from './confusion';

export interface ClassMetrics {
  readonly precision: number | null;
  readonly recall: number | null;
  readonly f1: number | null;
  readonly support: number;
}

export interface ClassificationMetrics {
  /** Correct ÷ predictions that resolved to PASS or FAIL. */
  readonly accuracy: number | null;
  readonly pass: ClassMetrics;
  readonly fail: ClassMetrics;
  readonly macroF1: number | null;
  readonly balancedAccuracy: number | null;
  readonly mcc: number | null;
}

/** Undefined ratios stay null instead of collapsing to 0, which would read as a
 * real score of zero rather than "not measurable from this run". */
const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

const f1Of = (precision: number | null, recall: number | null): number | null => {
  if (precision === null || recall === null) return null;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
};

const meanOfDefined = (values: readonly (number | null)[]): number | null => {
  const defined = values.filter((value): value is number => value !== null);
  if (defined.length === 0) return null;
  return defined.reduce((total, value) => total + value, 0) / defined.length;
};

export const classMetricsFor = (
  matrix: ConfusionMatrix,
  positive: 'PASS' | 'FAIL',
): ClassMetrics => {
  const truePositive =
    positive === 'PASS' ? matrix.goldPassPredictedPass : matrix.goldFailPredictedFail;
  const falsePositive =
    positive === 'PASS' ? matrix.goldFailPredictedPass : matrix.goldPassPredictedFail;
  const falseNegative =
    positive === 'PASS' ? matrix.goldPassPredictedFail : matrix.goldFailPredictedPass;

  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);

  return { precision, recall, f1: f1Of(precision, recall), support: truePositive + falseNegative };
};

/**
 * Matthews correlation coefficient. Reported because on a skewed dataset it
 * stays honest where accuracy does not: a model that always answers PASS scores
 * 0 here regardless of how much of the dataset is PASS.
 */
export const matthewsCorrelation = (matrix: ConfusionMatrix): number | null => {
  const truePositive = matrix.goldPassPredictedPass;
  const trueNegative = matrix.goldFailPredictedFail;
  const falsePositive = matrix.goldFailPredictedPass;
  const falseNegative = matrix.goldPassPredictedFail;

  const denominatorSquared =
    (truePositive + falsePositive) *
    (truePositive + falseNegative) *
    (trueNegative + falsePositive) *
    (trueNegative + falseNegative);

  if (denominatorSquared === 0) return null;

  return (
    (truePositive * trueNegative - falsePositive * falseNegative) / Math.sqrt(denominatorSquared)
  );
};

export const computeClassificationMetrics = (
  matrix: ConfusionMatrix,
): ClassificationMetrics => {
  const pass = classMetricsFor(matrix, 'PASS');
  const fail = classMetricsFor(matrix, 'FAIL');

  return {
    accuracy: ratio(correctCount(matrix), matrix.total),
    pass,
    fail,
    macroF1: meanOfDefined([pass.f1, fail.f1]),
    balancedAccuracy: meanOfDefined([pass.recall, fail.recall]),
    mcc: matthewsCorrelation(matrix),
  };
};
