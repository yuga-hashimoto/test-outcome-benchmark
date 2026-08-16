import { isResolved } from '../domain/verdict';
import type { EvaluatedPrediction } from '../domain/prediction';
import type { PredictedVerdict, Verdict } from '../domain/verdict';

export interface StabilityMetrics {
  readonly repetitions: number;
  readonly casesEvaluated: number;
  /** Share of cases where every repetition produced the same answer. */
  readonly consistencyRate: number | null;
  /** Share of consecutive repetition transitions where the answer changed. */
  readonly flipRate: number | null;
  /** Accuracy of the per-case majority vote across repetitions. */
  readonly majorityAccuracy: number | null;
  readonly casesWithoutMajority: number;
  readonly perRepetitionAccuracy: readonly (number | null)[];
  readonly accuracyStdDev: number | null;
}

const groupByCase = (
  predictions: readonly EvaluatedPrediction[],
): Map<string, EvaluatedPrediction[]> => {
  const groups = new Map<string, EvaluatedPrediction[]>();
  for (const prediction of predictions) {
    const existing = groups.get(prediction.caseId) ?? [];
    existing.push(prediction);
    groups.set(prediction.caseId, existing);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.repetition - right.repetition);
  }
  return groups;
};

/** An unresolved answer is its own outcome for stability purposes: a model that
 * alternates between FAIL and malformed output is not stable. */
const answerOf = (prediction: EvaluatedPrediction): PredictedVerdict | 'NONE' =>
  prediction.predictedVerdict ?? 'NONE';

const majorityVerdictOf = (group: readonly EvaluatedPrediction[]): Verdict | null => {
  let pass = 0;
  let fail = 0;
  for (const prediction of group) {
    if (prediction.predictedVerdict === 'PASS') pass += 1;
    if (prediction.predictedVerdict === 'FAIL') fail += 1;
  }
  if (pass === fail) return null;
  return pass > fail ? 'PASS' : 'FAIL';
};

const standardDeviation = (values: readonly number[]): number | null => {
  if (values.length < 2) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

export const computeStabilityMetrics = (
  predictions: readonly EvaluatedPrediction[],
): StabilityMetrics => {
  const groups = groupByCase(predictions);
  const repetitionNumbers = [...new Set(predictions.map((prediction) => prediction.repetition))].sort(
    (left, right) => left - right,
  );

  let consistentCases = 0;
  let comparableCases = 0;
  let transitions = 0;
  let flips = 0;
  let majorityCorrect = 0;
  let majorityScored = 0;
  let casesWithoutMajority = 0;

  for (const group of groups.values()) {
    if (group.length > 1) {
      comparableCases += 1;
      const answers = group.map(answerOf);
      if (new Set(answers).size === 1) consistentCases += 1;
      for (let index = 1; index < answers.length; index += 1) {
        transitions += 1;
        if (answers[index] !== answers[index - 1]) flips += 1;
      }
    }

    const gold = group[0]?.goldVerdict;
    const majority = majorityVerdictOf(group);
    if (majority === null) {
      if (group.some((prediction) => isResolved(prediction.predictedVerdict))) {
        casesWithoutMajority += 1;
      }
      continue;
    }
    majorityScored += 1;
    if (majority === gold) majorityCorrect += 1;
  }

  const perRepetitionAccuracy = repetitionNumbers.map((repetition) => {
    const inRepetition = predictions.filter(
      (prediction) => prediction.repetition === repetition && isResolved(prediction.predictedVerdict),
    );
    if (inRepetition.length === 0) return null;
    const correct = inRepetition.filter(
      (prediction) => prediction.predictedVerdict === prediction.goldVerdict,
    ).length;
    return correct / inRepetition.length;
  });

  return {
    repetitions: repetitionNumbers.length,
    casesEvaluated: groups.size,
    consistencyRate: comparableCases === 0 ? null : consistentCases / comparableCases,
    flipRate: transitions === 0 ? null : flips / transitions,
    majorityAccuracy: majorityScored === 0 ? null : majorityCorrect / majorityScored,
    casesWithoutMajority,
    perRepetitionAccuracy,
    accuracyStdDev: standardDeviation(
      perRepetitionAccuracy.filter((value): value is number => value !== null),
    ),
  };
};
