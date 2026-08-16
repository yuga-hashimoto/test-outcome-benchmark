import { describe, expect, it } from 'vitest';
import {
  brierScore,
  computeCalibrationMetrics,
  computeSafeSkipMetrics,
  expectedCalibrationError,
  thresholdPoints,
} from '@tob/core';
import { prediction } from './helpers';

/**
 * Four predictions chosen so every number below can be worked out on paper.
 * Implied P(PASS) is the confidence when the verdict is PASS and its complement
 * when the verdict is FAIL.
 */
const calibrationFixture = () => [
  prediction({ goldVerdict: 'PASS', predictedVerdict: 'PASS', confidence: 0.9 }),
  prediction({ goldVerdict: 'FAIL', predictedVerdict: 'FAIL', confidence: 0.7 }),
  prediction({ goldVerdict: 'FAIL', predictedVerdict: 'PASS', confidence: 0.6 }),
  prediction({ goldVerdict: 'PASS', predictedVerdict: 'FAIL', confidence: 0.8 }),
];

describe('brier score', () => {
  it('averages the squared error of the implied PASS probability', () => {
    // (0.9-1)^2 + (0.3-0)^2 + (0.6-0)^2 + (0.2-1)^2 = 0.01 + 0.09 + 0.36 + 0.64 = 1.10
    expect(brierScore(calibrationFixture())).toBeCloseTo(1.1 / 4, 12);
  });

  it('is null when no prediction carried a confidence', () => {
    expect(brierScore([prediction({ confidence: null })])).toBeNull();
  });
});

describe('expected calibration error', () => {
  it('weights each bucket by its share of confident predictions', () => {
    // Buckets: 0.6 -> acc 0, 0.7 -> acc 1, 0.8 -> acc 0, 0.9 -> acc 1
    // |0-0.6| + |1-0.7| + |0-0.8| + |1-0.9| = 0.6 + 0.3 + 0.8 + 0.1 = 1.8, over 4
    expect(expectedCalibrationError(calibrationFixture())).toBeCloseTo(1.8 / 4, 12);
  });
});

describe('threshold points', () => {
  it('reports coverage against every resolved prediction, not only confident ones', () => {
    const points = thresholdPoints(calibrationFixture(), [0.8]);
    const point = points[0];

    expect(point?.count).toBe(2);
    expect(point?.coverage).toBeCloseTo(2 / 4, 12);
    expect(point?.accuracy).toBeCloseTo(1 / 2, 12);
  });
});

describe('calibration metrics', () => {
  it('reports how many resolved predictions had a usable confidence', () => {
    const metrics = computeCalibrationMetrics([
      ...calibrationFixture(),
      prediction({ goldVerdict: 'PASS', predictedVerdict: 'PASS', confidence: null }),
    ]);

    expect(metrics.resolvedTotal).toBe(5);
    expect(metrics.withConfidence).toBe(4);
  });

  it('puts a confidence of exactly 1 in the top bucket', () => {
    const metrics = computeCalibrationMetrics([
      prediction({ goldVerdict: 'PASS', predictedVerdict: 'PASS', confidence: 1 }),
    ]);

    expect(metrics.buckets[9]?.count).toBe(1);
  });
});

describe('safe skip analysis', () => {
  it('reports missed failures as an absolute count, not only a rate', () => {
    const metrics = computeSafeSkipMetrics(
      [
        prediction({ goldVerdict: 'PASS', predictedVerdict: 'PASS', confidence: 0.95 }),
        prediction({ goldVerdict: 'PASS', predictedVerdict: 'PASS', confidence: 0.95 }),
        prediction({ goldVerdict: 'PASS', predictedVerdict: 'PASS', confidence: 0.95 }),
        prediction({ goldVerdict: 'FAIL', predictedVerdict: 'PASS', confidence: 0.95 }),
      ],
      [0.9],
    );

    const point = metrics.points[0];
    expect(point?.skipped).toBe(4);
    expect(point?.missedFailures).toBe(1);
    expect(point?.safePassAccuracy).toBeCloseTo(3 / 4, 12);
    expect(point?.missedFailureRate).toBeCloseTo(1 / 4, 12);
  });

  it('never counts a FAIL prediction as skippable work', () => {
    const metrics = computeSafeSkipMetrics(
      [prediction({ goldVerdict: 'FAIL', predictedVerdict: 'FAIL', confidence: 0.99 })],
      [0.9],
    );

    expect(metrics.points[0]?.skipped).toBe(0);
  });
});
