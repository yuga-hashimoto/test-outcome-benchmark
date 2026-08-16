import { describe, expect, it } from 'vitest';
import { computeCostMetrics, computeLatencyMetrics, estimateCost, percentile, summarize } from '@tob/core';
import { latency, prediction, usage } from './helpers';
import type { ModelPricing } from '@tob/core';

const pricing: ModelPricing = {
  currency: 'USD',
  inputPerMillion: 3,
  outputPerMillion: 15,
  cachedInputPerMillion: 0.3,
  reasoningPerMillion: null,
  source: 'test',
  snapshotAt: '2026-01-01T00:00:00.000Z',
};

describe('percentiles', () => {
  it('interpolates linearly between closest ranks', () => {
    const values = [10, 20, 30, 40];
    // p50 sits at rank 1.5 -> 20 + (30-20)*0.5
    expect(percentile(values, 0.5)).toBeCloseTo(25, 12);
    // p90 sits at rank 2.7 -> 30 + (40-30)*0.7
    expect(percentile(values, 0.9)).toBeCloseTo(37, 12);
  });

  it('returns null for an empty sample rather than zero', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(summarize([]).count).toBe(0);
  });
});

describe('latency metrics', () => {
  it('excludes null TTFT samples instead of treating them as zero', () => {
    const metrics = computeLatencyMetrics([
      prediction({ latency: latency({ endToEndMs: 100, ttftMs: null }) }),
      prediction({ latency: latency({ endToEndMs: 300, ttftMs: 50 }) }),
    ]);

    expect(metrics.endToEnd.count).toBe(2);
    expect(metrics.timeToFirstToken.count).toBe(1);
    expect(metrics.timeToFirstToken.mean).toBe(50);
  });

  it('derives throughput from wall clock time when the runner supplies it', () => {
    const metrics = computeLatencyMetrics(
      [prediction({ latency: latency({ endToEndMs: 100 }) })],
      30_000,
    );

    expect(metrics.testsPerMinute).toBeCloseTo(2, 12);
  });
});

describe('cost estimation', () => {
  it('bills cached input tokens at the cached rate', () => {
    // 800 uncached * 3/M + 200 cached * 0.3/M + 500 output * 15/M
    const cost = estimateCost(
      usage({ inputTokens: 1000, cachedTokens: 200, outputTokens: 500 }),
      pricing,
    );

    expect(cost).toBeCloseTo(0.0024 + 0.00006 + 0.0075, 12);
  });

  it('does not double bill reasoning tokens when no reasoning rate is given', () => {
    const withReasoning = estimateCost(
      usage({ inputTokens: 0, outputTokens: 100, reasoningTokens: 100 }),
      pricing,
    );
    const withoutReasoning = estimateCost(
      usage({ inputTokens: 0, outputTokens: 100, reasoningTokens: 0 }),
      pricing,
    );

    expect(withReasoning).toBe(withoutReasoning);
  });

  it('bills reasoning separately once the snapshot prices it', () => {
    const cost = estimateCost(usage({ inputTokens: 0, outputTokens: 0, reasoningTokens: 1000 }), {
      ...pricing,
      reasoningPerMillion: 10,
    });

    expect(cost).toBeCloseTo(0.00001 * 1000, 12);
  });

  it('returns null without a pricing snapshot rather than guessing zero', () => {
    expect(estimateCost(usage(), null)).toBeNull();
  });
});

describe('cost metrics', () => {
  it('reports cost per test, per thousand, and correct predictions per dollar', () => {
    const metrics = computeCostMetrics([
      prediction({ goldVerdict: 'PASS', predictedVerdict: 'PASS', costUsd: 0.01 }),
      prediction({ goldVerdict: 'PASS', predictedVerdict: 'FAIL', costUsd: 0.01 }),
    ]);

    expect(metrics.totalUsd).toBeCloseTo(0.02, 12);
    expect(metrics.costPerTest).toBeCloseTo(0.01, 12);
    expect(metrics.costPer1000Tests).toBeCloseTo(10, 12);
    expect(metrics.correctPerDollar).toBeCloseTo(1 / 0.02, 12);
  });

  it('counts unpriced predictions instead of silently valuing them at zero', () => {
    const metrics = computeCostMetrics([prediction({ costUsd: null })]);

    expect(metrics.totalUsd).toBeNull();
    expect(metrics.unpricedPredictions).toBe(1);
  });
});
