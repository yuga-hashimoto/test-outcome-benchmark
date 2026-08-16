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
  it('separates accuracy over resolved from strict accuracy over attempted', () => {
    const metrics = aggregateRunMetrics(goldenPredictions(), { bootstrapResamples: 50 });

    expect(metrics.counts.attempted).toBe(12);
    expect(metrics.counts.resolved).toBe(11);
    expect(metrics.counts.correct).toBe(7);
    expect(metrics.accuracy).toBeCloseTo(7 / 11, 12);
    expect(metrics.strictAccuracy).toBeCloseTo(7 / 12, 12);
  });

  it('counts contract violations without letting them inflate accuracy', () => {
    const metrics = aggregateRunMetrics(goldenPredictions(), { bootstrapResamples: 50 });

    expect(metrics.counts.contractViolations).toBe(1);
    expect(metrics.counts.infrastructureErrors).toBe(0);
  });

  it('reports the false PASS count separately', () => {
    const metrics = aggregateRunMetrics(goldenPredictions(), { bootstrapResamples: 50 });
    expect(metrics.counts.falsePass).toBe(2);
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
