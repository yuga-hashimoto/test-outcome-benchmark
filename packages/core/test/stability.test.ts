import { describe, expect, it } from 'vitest';
import { computeFlipPairMetrics, computeStabilityMetrics } from '@tob/core';
import { prediction } from './helpers';

/**
 * Two cases over three repetitions.
 * A (gold PASS): PASS, PASS, PASS — stable and correct.
 * B (gold FAIL): PASS, FAIL, FAIL — one flip, majority is still correct.
 */
const stabilityFixture = () => [
  prediction({ caseId: 'A', repetition: 0, goldVerdict: 'PASS', predictedVerdict: 'PASS' }),
  prediction({ caseId: 'A', repetition: 1, goldVerdict: 'PASS', predictedVerdict: 'PASS' }),
  prediction({ caseId: 'A', repetition: 2, goldVerdict: 'PASS', predictedVerdict: 'PASS' }),
  prediction({ caseId: 'B', repetition: 0, goldVerdict: 'FAIL', predictedVerdict: 'PASS' }),
  prediction({ caseId: 'B', repetition: 1, goldVerdict: 'FAIL', predictedVerdict: 'FAIL' }),
  prediction({ caseId: 'B', repetition: 2, goldVerdict: 'FAIL', predictedVerdict: 'FAIL' }),
];

describe('stability metrics', () => {
  const metrics = computeStabilityMetrics(stabilityFixture());

  it('counts a case as consistent only when every repetition agrees', () => {
    expect(metrics.casesEvaluated).toBe(2);
    expect(metrics.consistencyRate).toBeCloseTo(1 / 2, 12);
  });

  it('measures flips over consecutive repetition transitions', () => {
    // Four transitions in total, one of which changed the answer.
    expect(metrics.flipRate).toBeCloseTo(1 / 4, 12);
  });

  it('scores the per-case majority vote', () => {
    expect(metrics.majorityAccuracy).toBe(1);
    expect(metrics.casesWithoutMajority).toBe(0);
  });

  it('reports accuracy per repetition so run-to-run spread is visible', () => {
    expect(metrics.perRepetitionAccuracy).toEqual([0.5, 1, 1]);
    expect(metrics.accuracyStdDev).toBeGreaterThan(0);
  });

  it('treats an unresolved answer as its own outcome', () => {
    const unstable = computeStabilityMetrics([
      prediction({ caseId: 'C', repetition: 0, predictedVerdict: 'PASS' }),
      prediction({ caseId: 'C', repetition: 1, predictedVerdict: null }),
    ]);

    expect(unstable.consistencyRate).toBe(0);
  });

  it('records a tie as having no majority', () => {
    const tied = computeStabilityMetrics([
      prediction({ caseId: 'D', repetition: 0, goldVerdict: 'PASS', predictedVerdict: 'PASS' }),
      prediction({ caseId: 'D', repetition: 1, goldVerdict: 'PASS', predictedVerdict: 'FAIL' }),
    ]);

    expect(tied.casesWithoutMajority).toBe(1);
    expect(tied.majorityAccuracy).toBeNull();
  });
});

describe('flip pair metrics', () => {
  const flipPair = (baseVerdict: 'PASS' | 'FAIL', headVerdict: 'PASS' | 'FAIL') => [
    prediction({
      caseId: 'pair-base',
      flipPairId: 'p1',
      revision: 'base',
      goldVerdict: 'FAIL',
      predictedVerdict: baseVerdict,
    }),
    prediction({
      caseId: 'pair-head',
      flipPairId: 'p1',
      revision: 'head',
      goldVerdict: 'PASS',
      predictedVerdict: headVerdict,
    }),
  ];

  it('credits a pair only when both sides are correct', () => {
    expect(computeFlipPairMetrics(flipPair('FAIL', 'PASS')).accuracy).toBe(1);
    expect(computeFlipPairMetrics(flipPair('PASS', 'PASS')).accuracy).toBe(0);
    expect(computeFlipPairMetrics(flipPair('FAIL', 'FAIL')).accuracy).toBe(0);
  });

  it('gives an always-PASS model a flip pair accuracy of zero despite 50% accuracy', () => {
    const metrics = computeFlipPairMetrics(flipPair('PASS', 'PASS'));

    expect(metrics.pairs).toBe(1);
    expect(metrics.evaluated).toBe(1);
    expect(metrics.bothCorrect).toBe(0);
  });

  it('excludes a pair from the denominator when one side produced no verdict', () => {
    const metrics = computeFlipPairMetrics([
      prediction({
        caseId: 'pair-base',
        flipPairId: 'p1',
        revision: 'base',
        goldVerdict: 'FAIL',
        predictedVerdict: null,
      }),
      prediction({
        caseId: 'pair-head',
        flipPairId: 'p1',
        revision: 'head',
        goldVerdict: 'PASS',
        predictedVerdict: 'PASS',
      }),
    ]);

    expect(metrics.pairs).toBe(1);
    expect(metrics.evaluated).toBe(0);
    expect(metrics.accuracy).toBeNull();
  });

  it('scores each repetition of a pair separately', () => {
    const metrics = computeFlipPairMetrics([
      ...flipPair('FAIL', 'PASS').map((item) => ({ ...item, repetition: 0 })),
      ...flipPair('PASS', 'PASS').map((item) => ({ ...item, repetition: 1 })),
    ]);

    expect(metrics.evaluated).toBe(2);
    expect(metrics.accuracy).toBeCloseTo(1 / 2, 12);
  });
});
