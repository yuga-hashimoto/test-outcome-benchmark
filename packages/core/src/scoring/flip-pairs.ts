import { isResolved } from '../domain/verdict';
import type { EvaluatedPrediction } from '../domain/prediction';

export interface FlipPairOutcome {
  readonly flipPairId: string;
  readonly repetition: number;
  readonly baseCaseId: string | null;
  readonly headCaseId: string | null;
  readonly baseCorrect: boolean | null;
  readonly headCorrect: boolean | null;
  readonly bothCorrect: boolean;
}

export interface FlipPairMetrics {
  readonly pairs: number;
  /** Pair-repetitions where both sides produced a usable verdict. */
  readonly evaluated: number;
  readonly bothCorrect: number;
  readonly accuracy: number | null;
  readonly outcomes: readonly FlipPairOutcome[];
}

/**
 * A flip pair is the same natural-language test either side of a change, where
 * the real outcome flips. Scoring both sides jointly is what distinguishes
 * understanding the change from having a good prior on the test: a model that
 * always answers PASS gets one side of every pair right and scores zero here.
 */
export const computeFlipPairMetrics = (
  predictions: readonly EvaluatedPrediction[],
): FlipPairMetrics => {
  const groups = new Map<string, EvaluatedPrediction[]>();

  for (const prediction of predictions) {
    if (prediction.flipPairId === null) continue;
    const key = `${prediction.flipPairId}::${prediction.repetition}`;
    const existing = groups.get(key) ?? [];
    existing.push(prediction);
    groups.set(key, existing);
  }

  const outcomes: FlipPairOutcome[] = [];
  const distinctPairs = new Set<string>();

  for (const [key, members] of groups) {
    const [flipPairId = '', repetitionText = '0'] = key.split('::');
    distinctPairs.add(flipPairId);

    const base = members.find((prediction) => prediction.revision === 'base') ?? null;
    const head = members.find((prediction) => prediction.revision === 'head') ?? null;

    const correctnessOf = (prediction: EvaluatedPrediction | null): boolean | null => {
      if (prediction === null) return null;
      if (!isResolved(prediction.predictedVerdict)) return null;
      return prediction.predictedVerdict === prediction.goldVerdict;
    };

    const baseCorrect = correctnessOf(base);
    const headCorrect = correctnessOf(head);

    outcomes.push({
      flipPairId,
      repetition: Number(repetitionText),
      baseCaseId: base?.caseId ?? null,
      headCaseId: head?.caseId ?? null,
      baseCorrect,
      headCorrect,
      bothCorrect: baseCorrect === true && headCorrect === true,
    });
  }

  outcomes.sort(
    (left, right) =>
      left.flipPairId.localeCompare(right.flipPairId) || left.repetition - right.repetition,
  );

  const evaluated = outcomes.filter(
    (outcome) => outcome.baseCorrect !== null && outcome.headCorrect !== null,
  );
  const bothCorrect = evaluated.filter((outcome) => outcome.bothCorrect).length;

  return {
    pairs: distinctPairs.size,
    evaluated: evaluated.length,
    bothCorrect,
    accuracy: evaluated.length === 0 ? null : bothCorrect / evaluated.length,
    outcomes,
  };
};
