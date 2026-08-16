import { describe, expect, it } from 'vitest';
import {
  aggregateRunMetrics,
  buildConfusionMatrix,
  computeBaselines,
  computeClassificationMetrics,
  computeSelectiveMetrics,
} from '@tob/core';
import { goldenPredictions, prediction } from './helpers';

const CLOSE = 1e-9;

describe('confusion matrix', () => {
  it('places each resolved prediction in the cell named by (gold, predicted)', () => {
    const matrix = buildConfusionMatrix(goldenPredictions());

    expect(matrix).toEqual({
      goldPassPredictedPass: 4,
      goldPassPredictedFail: 2,
      goldFailPredictedPass: 2,
      goldFailPredictedFail: 3,
      total: 11,
    });
  });

  it('excludes predictions that produced no verdict', () => {
    const matrix = buildConfusionMatrix([
      prediction({ goldVerdict: 'PASS', predictedVerdict: null }),
      prediction({ goldVerdict: 'PASS', predictedVerdict: 'UNKNOWN' }),
    ]);

    expect(matrix.total).toBe(0);
  });
});

describe('classification metrics', () => {
  const metrics = computeClassificationMetrics(buildConfusionMatrix(goldenPredictions()));

  it('computes accuracy over resolved predictions', () => {
    expect(metrics.accuracy).toBeCloseTo(7 / 11, 12);
  });

  it('computes PASS precision, recall and F1', () => {
    expect(metrics.pass.precision).toBeCloseTo(4 / 6, 12);
    expect(metrics.pass.recall).toBeCloseTo(4 / 6, 12);
    expect(metrics.pass.f1).toBeCloseTo(4 / 6, 12);
    expect(metrics.pass.support).toBe(6);
  });

  it('computes FAIL precision, recall and F1', () => {
    expect(metrics.fail.precision).toBeCloseTo(3 / 5, 12);
    expect(metrics.fail.recall).toBeCloseTo(3 / 5, 12);
    expect(metrics.fail.f1).toBeCloseTo(3 / 5, 12);
    expect(metrics.fail.support).toBe(5);
  });

  it('computes macro F1 and balanced accuracy as the mean of the two classes', () => {
    expect(metrics.macroF1).toBeCloseTo((4 / 6 + 3 / 5) / 2, 12);
    expect(metrics.balancedAccuracy).toBeCloseTo((4 / 6 + 3 / 5) / 2, 12);
  });

  it('computes MCC as (4*3 - 2*2) / sqrt(6*6*5*5) = 8/30', () => {
    expect(metrics.mcc).toBeCloseTo(8 / 30, 12);
  });

  it('returns null rather than zero when a class is never predicted', () => {
    const onlyPass = computeClassificationMetrics(
      buildConfusionMatrix([prediction({ goldVerdict: 'PASS', predictedVerdict: 'PASS' })]),
    );

    expect(onlyPass.fail.precision).toBeNull();
    expect(onlyPass.mcc).toBeNull();
  });
});

describe('accuracy denominators', () => {
  /**
   * In FORCED mode the model had to commit to a verdict, so failing to
   * produce one validly is a wrong answer. The headline `accuracy` must use
   * the attempted denominator — not the resolved one — or a configuration
   * could climb the leaderboard by emitting malformed output on the cases it
   * finds hard.
   */
  it('scores unresolved forced attempts as wrong: accuracy equals strictAccuracy', () => {
    const metrics = aggregateRunMetrics(goldenPredictions(), { predictionMode: 'FORCED', bootstrapResamples: 50 });

    expect(metrics.counts.attempted).toBe(12);
    expect(metrics.counts.resolved).toBe(11);
    expect(metrics.counts.correct).toBe(7);
    expect(metrics.accuracy).toBeCloseTo(7 / 12, 12);
    expect(metrics.strictAccuracy).toBeCloseTo(7 / 12, 12);
    expect(metrics.accuracy).toBe(metrics.strictAccuracy);
  });

  /**
   * SELECTIVE mode is the one place a resolved-denominator accuracy is
   * legitimate: abstaining is an allowed answer, not a failure, so accuracy
   * over what the model chose to answer is reported separately from coverage
   * rather than folded into a single attempted-denominator number.
   */
  it('keeps a resolved-denominator accuracy in SELECTIVE mode, separate from coverage', () => {
    const metrics = aggregateRunMetrics(goldenPredictions(), {
      predictionMode: 'SELECTIVE',
      bootstrapResamples: 50,
    });

    expect(metrics.accuracy).toBeCloseTo(7 / 11, 12);
    expect(metrics.strictAccuracy).toBeCloseTo(7 / 12, 12);
    expect(metrics.selective.coverage).toBeCloseTo(11 / 12, 12);
  });

  it('counts contract violations without letting them inflate accuracy', () => {
    const metrics = aggregateRunMetrics(goldenPredictions(), { predictionMode: 'FORCED', bootstrapResamples: 50 });

    expect(metrics.counts.contractViolations).toBe(1);
    expect(metrics.counts.infrastructureErrors).toBe(0);
  });

  it('reports the false PASS count separately', () => {
    const metrics = aggregateRunMetrics(goldenPredictions(), { predictionMode: 'FORCED', bootstrapResamples: 50 });
    expect(metrics.counts.falsePass).toBe(2);
  });
});

/**
 * headAccuracy exists because the benchmark's actual question — given this
 * test and this PR, does it pass or fail right now — is a question about
 * the head revision. A base-revision case asks the different, counterfactual
 * question of what the test would have done before the change, so it must
 * not be able to move the primary number.
 */
describe('head-only accuracy', () => {
  const mixedRevisionPredictions = () => [
    prediction({ revision: 'head', goldVerdict: 'PASS', predictedVerdict: 'PASS' }),
    prediction({ revision: 'head', goldVerdict: 'PASS', predictedVerdict: 'PASS' }),
    prediction({ revision: 'head', goldVerdict: 'FAIL', predictedVerdict: 'PASS' }),
    prediction({ revision: 'base', goldVerdict: 'FAIL', predictedVerdict: 'FAIL' }),
    prediction({ revision: 'base', goldVerdict: 'FAIL', predictedVerdict: 'FAIL' }),
    prediction({ revision: 'base', goldVerdict: 'FAIL', predictedVerdict: 'FAIL' }),
    prediction({ revision: 'base', goldVerdict: 'FAIL', predictedVerdict: 'FAIL' }),
  ];

  it('scores only head-revision predictions, independent of how base-revision cases went', () => {
    const metrics = aggregateRunMetrics(mixedRevisionPredictions(), {
      predictionMode: 'FORCED',
      bootstrapResamples: 50,
    });

    expect(metrics.headCount).toBe(3);
    expect(metrics.headAccuracy).toBeCloseTo(2 / 3, 12);
    expect(metrics.headStrictAccuracy).toBe(metrics.headAccuracy);
    /** The combined figure is different from the head-only one — a model
     * that is perfect on the (easier) base-revision cases here would
     * otherwise mask a mediocre head-revision result. */
    expect(metrics.accuracy).toBeCloseTo(6 / 7, 12);
    expect(metrics.accuracy).not.toBeCloseTo(metrics.headAccuracy!, 6);
  });

  it('is null with a zero count rather than a hidden zero when a run has no head-revision predictions', () => {
    const allBase = [
      prediction({ revision: 'base', goldVerdict: 'PASS', predictedVerdict: 'PASS' }),
      prediction({ revision: 'base', goldVerdict: 'FAIL', predictedVerdict: 'FAIL' }),
    ];
    const metrics = aggregateRunMetrics(allBase, { predictionMode: 'FORCED', bootstrapResamples: 50 });

    expect(metrics.headCount).toBe(0);
    expect(metrics.headAccuracy).toBeNull();
    expect(metrics.headAccuracyInterval.estimate).toBeNull();
  });

  it('follows the same FORCED/SELECTIVE denominator rule as the combined accuracy', () => {
    const withAbstention = [
      ...mixedRevisionPredictions(),
      prediction({
        revision: 'head',
        goldVerdict: 'PASS',
        predictedVerdict: null,
        confidence: null,
        errorKind: 'OUTPUT_CONTRACT',
      }),
    ];

    const forced = aggregateRunMetrics(withAbstention, { predictionMode: 'FORCED', bootstrapResamples: 50 });
    expect(forced.headCount).toBe(4);
    expect(forced.headAccuracy).toBeCloseTo(2 / 4, 12);

    const selective = aggregateRunMetrics(withAbstention, {
      predictionMode: 'SELECTIVE',
      bootstrapResamples: 50,
    });
    expect(selective.headAccuracy).toBeCloseTo(2 / 3, 12);
    expect(selective.headStrictAccuracy).toBeCloseTo(2 / 4, 12);
  });
});

describe('selective metrics', () => {
  it('measures coverage, abstention and accuracy on the covered subset', () => {
    const metrics = computeSelectiveMetrics([
      prediction({ goldVerdict: 'PASS', predictedVerdict: 'PASS' }),
      prediction({ goldVerdict: 'FAIL', predictedVerdict: 'FAIL' }),
      prediction({ goldVerdict: 'FAIL', predictedVerdict: 'PASS' }),
      prediction({ goldVerdict: 'PASS', predictedVerdict: 'UNKNOWN' }),
    ]);

    expect(metrics.attempted).toBe(4);
    expect(metrics.covered).toBe(3);
    expect(metrics.abstained).toBe(1);
    expect(metrics.coverage).toBeCloseTo(3 / 4, CLOSE);
    expect(metrics.selectiveAccuracy).toBeCloseTo(2 / 3, CLOSE);
    expect(metrics.abstentionRate).toBeCloseTo(1 / 4, CLOSE);
  });
});

describe('baselines', () => {
  const baselines = computeBaselines(goldenPredictions(), 'test-seed');

  it('scores baselines on the same items the headline accuracy uses', () => {
    expect(baselines.evaluated).toBe(11);
    expect(baselines.alwaysPass.accuracy).toBeCloseTo(6 / 11, 12);
    expect(baselines.alwaysFail.accuracy).toBeCloseTo(5 / 11, 12);
  });

  it('picks PASS as the majority class and labels it', () => {
    expect(baselines.majorityClass.accuracy).toBeCloseTo(6 / 11, 12);
    expect(baselines.majorityClass.label).toBe('Majority class (PASS)');
  });

  it('is deterministic for a given seed', () => {
    const repeat = computeBaselines(goldenPredictions(), 'test-seed');
    expect(repeat.random.accuracy).toBe(baselines.random.accuracy);
  });
});
