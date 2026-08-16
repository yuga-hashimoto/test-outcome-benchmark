import { describe, expect, it } from 'vitest';
import { clusterBootstrapAccuracy, pairedClusterBootstrapDelta } from '@tob/core';
import { prediction } from './helpers';

const across = (clusters: number, perCluster: number, correct: (index: number) => boolean) =>
  Array.from({ length: clusters }, (_unused, clusterIndex) =>
    Array.from({ length: perCluster }, () =>
      prediction({
        clusterId: `owner/repo#${clusterIndex}`,
        caseId: `c${clusterIndex}-${Math.random()}`,
        goldVerdict: 'PASS',
        predictedVerdict: correct(clusterIndex) ? 'PASS' : 'FAIL',
      }),
    ),
  ).flat();

describe('cluster bootstrap', () => {
  it('brackets the point estimate', () => {
    const predictions = across(10, 3, (index) => index % 2 === 0);
    const interval = clusterBootstrapAccuracy(predictions, { resamples: 400, seed: 'fixed' });

    expect(interval.estimate).toBeCloseTo(0.5, 12);
    expect(interval.lower).not.toBeNull();
    expect(interval.upper).not.toBeNull();
    expect(interval.lower as number).toBeLessThanOrEqual(interval.estimate as number);
    expect(interval.upper as number).toBeGreaterThanOrEqual(interval.estimate as number);
  });

  it('is reproducible for a fixed seed', () => {
    const predictions = across(8, 2, (index) => index % 3 !== 0);
    const first = clusterBootstrapAccuracy(predictions, { resamples: 200, seed: 'abc' });
    const second = clusterBootstrapAccuracy(predictions, { resamples: 200, seed: 'abc' });

    expect(first).toEqual(second);
  });

  it('resamples pull requests, not individual predictions', () => {
    const predictions = across(4, 5, (index) => index < 2);
    const interval = clusterBootstrapAccuracy(predictions, { resamples: 200, seed: 'abc' });

    expect(interval.clusters).toBe(4);
  });

  it('declines to produce an interval from a single cluster', () => {
    const predictions = across(1, 5, () => true);
    const interval = clusterBootstrapAccuracy(predictions, { resamples: 200 });

    expect(interval.estimate).toBe(1);
    expect(interval.lower).toBeNull();
    expect(interval.upper).toBeNull();
  });
});

describe('paired comparison', () => {
  const baseline = [
    prediction({ caseId: 'a', clusterId: 'r#1', goldVerdict: 'PASS', predictedVerdict: 'PASS' }),
    prediction({ caseId: 'b', clusterId: 'r#1', goldVerdict: 'PASS', predictedVerdict: 'FAIL' }),
    prediction({ caseId: 'c', clusterId: 'r#2', goldVerdict: 'FAIL', predictedVerdict: 'PASS' }),
    prediction({ caseId: 'd', clusterId: 'r#3', goldVerdict: 'FAIL', predictedVerdict: 'FAIL' }),
  ];

  const candidate = [
    prediction({ caseId: 'a', clusterId: 'r#1', goldVerdict: 'PASS', predictedVerdict: 'PASS' }),
    prediction({ caseId: 'b', clusterId: 'r#1', goldVerdict: 'PASS', predictedVerdict: 'PASS' }),
    prediction({ caseId: 'c', clusterId: 'r#2', goldVerdict: 'FAIL', predictedVerdict: 'FAIL' }),
    prediction({ caseId: 'd', clusterId: 'r#3', goldVerdict: 'FAIL', predictedVerdict: 'FAIL' }),
  ];

  it('matches on case id and reports the delta', () => {
    const comparison = pairedClusterBootstrapDelta(baseline, candidate, {
      resamples: 300,
      seed: 'paired',
    });

    expect(comparison.matchedCases).toBe(4);
    expect(comparison.baselineAccuracy).toBeCloseTo(0.5, 12);
    expect(comparison.candidateAccuracy).toBeCloseTo(1, 12);
    expect(comparison.deltaAccuracy).toBeCloseTo(0.5, 12);
  });

  it('ignores cases only one side ran', () => {
    const comparison = pairedClusterBootstrapDelta(
      baseline,
      [...candidate, prediction({ caseId: 'extra', clusterId: 'r#9' })],
      { resamples: 100 },
    );

    expect(comparison.matchedCases).toBe(4);
  });
});
