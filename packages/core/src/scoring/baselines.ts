import { createRng } from '../rng';
import { resolvedPredictions } from './confusion';
import type { EvaluatedPrediction } from '../domain/prediction';
import type { Verdict } from '../domain/verdict';

export interface BaselineResult {
  readonly id: string;
  readonly label: string;
  readonly accuracy: number | null;
}

export interface BaselineMetrics {
  readonly alwaysPass: BaselineResult;
  readonly alwaysFail: BaselineResult;
  readonly random: BaselineResult;
  readonly majorityClass: BaselineResult;
  /** Items the baselines were scored on — the same ones the headline accuracy uses. */
  readonly evaluated: number;
}

const accuracyOf = (golds: readonly Verdict[], answer: (index: number) => Verdict): number | null => {
  if (golds.length === 0) return null;
  const correct = golds.filter((gold, index) => gold === answer(index)).length;
  return correct / golds.length;
};

/**
 * Baselines are scored on exactly the items the model resolved, not on the full
 * dataset. Scoring them on a different subset would make the comparison
 * meaningless: a model that abstains on the hard cases would be measured
 * against a baseline that did not get to skip them.
 */
export const computeBaselines = (
  predictions: readonly EvaluatedPrediction[],
  seed: number | string,
): BaselineMetrics => {
  const golds = resolvedPredictions(predictions).map((prediction) => prediction.goldVerdict);

  const passCount = golds.filter((gold) => gold === 'PASS').length;
  const majority: Verdict = passCount * 2 >= golds.length ? 'PASS' : 'FAIL';

  const rng = createRng(`baseline:${seed}`);
  const randomAnswers = golds.map((): Verdict => (rng.next() < 0.5 ? 'PASS' : 'FAIL'));

  return {
    alwaysPass: {
      id: 'always-pass',
      label: 'Always PASS',
      accuracy: accuracyOf(golds, () => 'PASS'),
    },
    alwaysFail: {
      id: 'always-fail',
      label: 'Always FAIL',
      accuracy: accuracyOf(golds, () => 'FAIL'),
    },
    random: {
      id: 'random',
      label: 'Random (seeded)',
      accuracy: accuracyOf(golds, (index) => randomAnswers[index] as Verdict),
    },
    majorityClass: {
      id: 'majority-class',
      label: `Majority class (${majority})`,
      accuracy: accuracyOf(golds, () => majority),
    },
    evaluated: golds.length,
  };
};
