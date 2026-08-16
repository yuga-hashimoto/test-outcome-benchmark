import { createRng } from '../rng';
import { percentile } from './latency';
import { resolvedPredictions } from './confusion';
import type { EvaluatedPrediction } from '../domain/prediction';

export interface ConfidenceInterval {
  readonly estimate: number | null;
  readonly lower: number | null;
  readonly upper: number | null;
  readonly level: number;
  readonly resamples: number;
  /** Number of clusters (pull requests) the interval was resampled over. */
  readonly clusters: number;
}

export interface BootstrapOptions {
  readonly resamples?: number;
  readonly level?: number;
  readonly seed?: number | string;
}

const DEFAULT_RESAMPLES = 1000;
const DEFAULT_LEVEL = 0.95;

const groupByCluster = (
  predictions: readonly EvaluatedPrediction[],
): EvaluatedPrediction[][] => {
  const groups = new Map<string, EvaluatedPrediction[]>();
  for (const prediction of predictions) {
    const existing = groups.get(prediction.clusterId) ?? [];
    existing.push(prediction);
    groups.set(prediction.clusterId, existing);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, members]) => members);
};

const accuracyOf = (predictions: readonly EvaluatedPrediction[]): number | null => {
  if (predictions.length === 0) return null;
  const correct = predictions.filter(
    (prediction) => prediction.predictedVerdict === prediction.goldVerdict,
  ).length;
  return correct / predictions.length;
};

/**
 * Confidence interval for accuracy, resampling whole pull requests rather than
 * individual predictions.
 *
 * Cases from one PR share a diff and often share their failure mode, so
 * treating them as independent draws produces intervals that are too narrow —
 * confidently wrong is the worst failure mode for a benchmark. Resampling
 * clusters keeps the correlation intact (spec §13).
 */
export const clusterBootstrapAccuracy = (
  predictions: readonly EvaluatedPrediction[],
  options: BootstrapOptions = {},
): ConfidenceInterval => {
  const level = options.level ?? DEFAULT_LEVEL;
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;
  const resolved = resolvedPredictions(predictions);
  const clusters = groupByCluster(resolved);

  const estimate = accuracyOf(resolved);

  if (clusters.length < 2 || estimate === null) {
    return { estimate, lower: null, upper: null, level, resamples: 0, clusters: clusters.length };
  }

  const rng = createRng(options.seed ?? 'bootstrap');
  const samples: number[] = [];

  for (let iteration = 0; iteration < resamples; iteration += 1) {
    const pooled: EvaluatedPrediction[] = [];
    for (let draw = 0; draw < clusters.length; draw += 1) {
      const cluster = clusters[rng.int(clusters.length)];
      if (cluster !== undefined) pooled.push(...cluster);
    }
    const accuracy = accuracyOf(pooled);
    if (accuracy !== null) samples.push(accuracy);
  }

  samples.sort((left, right) => left - right);
  const tail = (1 - level) / 2;

  return {
    estimate,
    lower: percentile(samples, tail),
    upper: percentile(samples, 1 - tail),
    level,
    resamples: samples.length,
    clusters: clusters.length,
  };
};

export interface PairedComparison {
  readonly baselineAccuracy: number | null;
  readonly candidateAccuracy: number | null;
  readonly deltaAccuracy: number | null;
  readonly interval: ConfidenceInterval;
  readonly matchedCases: number;
}

interface CaseScore {
  readonly clusterId: string;
  readonly baseline: number;
  readonly candidate: number;
}

const meanCorrectnessByCase = (
  predictions: readonly EvaluatedPrediction[],
): Map<string, { clusterId: string; value: number }> => {
  const groups = new Map<string, { clusterId: string; correct: number; total: number }>();
  for (const prediction of resolvedPredictions(predictions)) {
    const existing = groups.get(prediction.caseId) ?? {
      clusterId: prediction.clusterId,
      correct: 0,
      total: 0,
    };
    existing.total += 1;
    if (prediction.predictedVerdict === prediction.goldVerdict) existing.correct += 1;
    groups.set(prediction.caseId, existing);
  }

  const result = new Map<string, { clusterId: string; value: number }>();
  for (const [caseId, group] of groups) {
    result.set(caseId, { clusterId: group.clusterId, value: group.correct / group.total });
  }
  return result;
};

/**
 * Paired comparison of two runs over the same cases. Pairing removes
 * case difficulty from the comparison, so the interval reflects the difference
 * between the configurations rather than the spread of the dataset.
 */
export const pairedClusterBootstrapDelta = (
  baseline: readonly EvaluatedPrediction[],
  candidate: readonly EvaluatedPrediction[],
  options: BootstrapOptions = {},
): PairedComparison => {
  const level = options.level ?? DEFAULT_LEVEL;
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;

  const baselineScores = meanCorrectnessByCase(baseline);
  const candidateScores = meanCorrectnessByCase(candidate);

  const matched: CaseScore[] = [];
  for (const [caseId, baselineScore] of baselineScores) {
    const candidateScore = candidateScores.get(caseId);
    if (candidateScore === undefined) continue;
    matched.push({
      clusterId: baselineScore.clusterId,
      baseline: baselineScore.value,
      candidate: candidateScore.value,
    });
  }

  const mean = (values: readonly number[]): number | null =>
    values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;

  const baselineAccuracy = mean(matched.map((score) => score.baseline));
  const candidateAccuracy = mean(matched.map((score) => score.candidate));
  const deltaAccuracy =
    baselineAccuracy === null || candidateAccuracy === null
      ? null
      : candidateAccuracy - baselineAccuracy;

  const clusters = new Map<string, CaseScore[]>();
  for (const score of matched) {
    const existing = clusters.get(score.clusterId) ?? [];
    existing.push(score);
    clusters.set(score.clusterId, existing);
  }
  const clusterList = [...clusters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, members]) => members);

  if (clusterList.length < 2 || deltaAccuracy === null) {
    return {
      baselineAccuracy,
      candidateAccuracy,
      deltaAccuracy,
      interval: {
        estimate: deltaAccuracy,
        lower: null,
        upper: null,
        level,
        resamples: 0,
        clusters: clusterList.length,
      },
      matchedCases: matched.length,
    };
  }

  const rng = createRng(options.seed ?? 'paired-bootstrap');
  const samples: number[] = [];

  for (let iteration = 0; iteration < resamples; iteration += 1) {
    const pooled: CaseScore[] = [];
    for (let draw = 0; draw < clusterList.length; draw += 1) {
      const cluster = clusterList[rng.int(clusterList.length)];
      if (cluster !== undefined) pooled.push(...cluster);
    }
    const baselineMean = mean(pooled.map((score) => score.baseline));
    const candidateMean = mean(pooled.map((score) => score.candidate));
    if (baselineMean !== null && candidateMean !== null) {
      samples.push(candidateMean - baselineMean);
    }
  }

  samples.sort((left, right) => left - right);
  const tail = (1 - level) / 2;

  return {
    baselineAccuracy,
    candidateAccuracy,
    deltaAccuracy,
    interval: {
      estimate: deltaAccuracy,
      lower: percentile(samples, tail),
      upper: percentile(samples, 1 - tail),
      level,
      resamples: samples.length,
      clusters: clusterList.length,
    },
    matchedCases: matched.length,
  };
};
