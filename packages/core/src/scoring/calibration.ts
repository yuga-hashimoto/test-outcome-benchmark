import { resolvedPredictions } from './confusion';
import type { EvaluatedPrediction } from '../domain/prediction';
import type { Verdict } from '../domain/verdict';

export interface CalibrationBucket {
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly count: number;
  readonly meanConfidence: number | null;
  readonly accuracy: number | null;
}

export interface ThresholdPoint {
  readonly threshold: number;
  readonly coverage: number;
  readonly accuracy: number | null;
  readonly count: number;
}

export interface CalibrationMetrics {
  readonly brierScore: number | null;
  readonly expectedCalibrationError: number | null;
  readonly buckets: readonly CalibrationBucket[];
  readonly thresholds: readonly ThresholdPoint[];
  /** How many resolved predictions carried a usable confidence. */
  readonly withConfidence: number;
  readonly resolvedTotal: number;
}

export const DEFAULT_BUCKET_COUNT = 10;
export const DEFAULT_THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95] as const;

interface ConfidentPrediction {
  readonly confidence: number;
  readonly correct: boolean;
  /** Probability the model implicitly assigned to the PASS class. */
  readonly passProbability: number;
  readonly goldVerdict: Verdict;
}

const toConfidentPredictions = (
  predictions: readonly EvaluatedPrediction[],
): ConfidentPrediction[] =>
  resolvedPredictions(predictions)
    .filter((prediction) => prediction.confidence !== null)
    .map((prediction) => {
      const confidence = prediction.confidence as number;
      return {
        confidence,
        correct: prediction.predictedVerdict === prediction.goldVerdict,
        passProbability:
          prediction.predictedVerdict === 'PASS' ? confidence : 1 - confidence,
        goldVerdict: prediction.goldVerdict,
      };
    });

/**
 * Brier score over the implied probability of PASS. A model that says FAIL with
 * confidence 0.9 is asserting P(PASS) = 0.1, which is what makes a
 * verdict-plus-confidence pair scoreable as a probability at all.
 */
export const brierScore = (predictions: readonly EvaluatedPrediction[]): number | null => {
  const confident = toConfidentPredictions(predictions);
  if (confident.length === 0) return null;

  const total = confident.reduce((sum, item) => {
    const outcome = item.goldVerdict === 'PASS' ? 1 : 0;
    return sum + (item.passProbability - outcome) ** 2;
  }, 0);

  return total / confident.length;
};

/**
 * Bucket assignment by index rather than by comparing against computed bounds.
 *
 * `6 * 0.1` is 0.6000000000000001, so a confidence of exactly 0.6 fails a
 * `>= lowerBound` test and lands one bucket too low. Models emit round
 * confidences almost exclusively, so that error would hit most of the data.
 * The epsilon absorbs the same representation error in the other direction
 * (`0.3 * 10` is 2.9999999999999996).
 */
const bucketIndexOf = (confidence: number, bucketCount: number): number =>
  Math.min(bucketCount - 1, Math.max(0, Math.floor(confidence * bucketCount + 1e-9)));

export const calibrationBuckets = (
  predictions: readonly EvaluatedPrediction[],
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): CalibrationBucket[] => {
  const confident = toConfidentPredictions(predictions);
  const width = 1 / bucketCount;

  return Array.from({ length: bucketCount }, (_unused, index) => {
    const lowerBound = index * width;
    const upperBound = lowerBound + width;
    const members = confident.filter(
      (item) => bucketIndexOf(item.confidence, bucketCount) === index,
    );

    if (members.length === 0) {
      return { lowerBound, upperBound, count: 0, meanConfidence: null, accuracy: null };
    }

    return {
      lowerBound,
      upperBound,
      count: members.length,
      meanConfidence:
        members.reduce((sum, item) => sum + item.confidence, 0) / members.length,
      accuracy: members.filter((item) => item.correct).length / members.length,
    };
  });
};

export const expectedCalibrationError = (
  predictions: readonly EvaluatedPrediction[],
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): number | null => {
  const confident = toConfidentPredictions(predictions);
  if (confident.length === 0) return null;

  const buckets = calibrationBuckets(predictions, bucketCount);
  return buckets.reduce((total, bucket) => {
    if (bucket.count === 0 || bucket.accuracy === null || bucket.meanConfidence === null) {
      return total;
    }
    const weight = bucket.count / confident.length;
    return total + weight * Math.abs(bucket.accuracy - bucket.meanConfidence);
  }, 0);
};

/**
 * Accuracy and coverage as the confidence bar rises. Coverage is measured
 * against every resolved prediction, so a model that is accurate only on the
 * handful of cases it is sure about cannot hide that behind the accuracy line.
 */
export const thresholdPoints = (
  predictions: readonly EvaluatedPrediction[],
  thresholds: readonly number[] = DEFAULT_THRESHOLDS,
): ThresholdPoint[] => {
  const resolved = resolvedPredictions(predictions);
  const confident = toConfidentPredictions(predictions);

  return thresholds.map((threshold) => {
    const selected = confident.filter((item) => item.confidence >= threshold);
    return {
      threshold,
      count: selected.length,
      coverage: resolved.length === 0 ? 0 : selected.length / resolved.length,
      accuracy:
        selected.length === 0
          ? null
          : selected.filter((item) => item.correct).length / selected.length,
    };
  });
};

export const computeCalibrationMetrics = (
  predictions: readonly EvaluatedPrediction[],
): CalibrationMetrics => ({
  brierScore: brierScore(predictions),
  expectedCalibrationError: expectedCalibrationError(predictions),
  buckets: calibrationBuckets(predictions),
  thresholds: thresholdPoints(predictions),
  withConfidence: toConfidentPredictions(predictions).length,
  resolvedTotal: resolvedPredictions(predictions).length,
});
