import { describe, expect, it } from 'vitest';
import {
  METRIC_DESCRIPTORS,
  aggregateRunMetrics,
  buildModelPromptMatrix,
  dashboardHighlights,
  formalBenchmarkRuns,
  paretoFront,
  rankRuns,
} from '@tob/core';
import { latency, prediction, usage } from './helpers';
import type { RunSummary } from '@tob/core';

const summary = (
  overrides: Partial<Omit<RunSummary, 'metrics'>> & {
    accuracy?: number;
    costPerTest?: number;
    latencyP95?: number;
  } = {},
): RunSummary => {
  const correct = Math.round((overrides.accuracy ?? 0.5) * 10);
  const predictions = [
    ...Array.from({ length: correct }, (_unused, index) =>
      prediction({
        clusterId: `repo#${index % 3}`,
        goldVerdict: 'PASS',
        predictedVerdict: 'PASS',
        costUsd: overrides.costPerTest ?? 0.001,
        latency: latency({ endToEndMs: overrides.latencyP95 ?? 100 }),
        usage: usage(),
      }),
    ),
    ...Array.from({ length: 10 - correct }, (_unused, index) =>
      prediction({
        clusterId: `repo#${index % 3}`,
        goldVerdict: 'FAIL',
        predictedVerdict: 'PASS',
        costUsd: overrides.costPerTest ?? 0.001,
        latency: latency({ endToEndMs: overrides.latencyP95 ?? 100 }),
        usage: usage(),
      }),
    ),
  ];

  return {
    runId: 'run-1',
    runName: 'run',
    modelConfigId: 'model-1',
    modelName: 'model one',
    provider: 'mock',
    model: 'mock-lean',
    settings: {
      temperature: 0,
      topP: null,
      maxOutputTokens: 100,
      reasoningEffort: null,
      seed: null,
      stream: false,
    },
    promptId: 'prompt-1',
    promptName: 'prompt one',
    promptVersion: 1,
    promptHash: 'abc',
    contextStrategy: 'TEST_PLUS_DIFF',
    datasetVersionId: 'dv-1',
    datasetVersion: 1,
    split: null,
    resolved: 10,
    finishedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
    metrics: aggregateRunMetrics(predictions, { bootstrapResamples: 20 }),
  };
};

describe('ranking', () => {
  const runs = [
    summary({ runId: 'a', modelName: 'A', accuracy: 0.8, costPerTest: 0.01 }),
    summary({ runId: 'b', modelName: 'B', accuracy: 0.6, costPerTest: 0.001 }),
    summary({ runId: 'c', modelName: 'C', accuracy: 0.7, costPerTest: 0.005 }),
  ];

  it('orders descending for a higher-is-better metric', () => {
    const ranked = rankRuns(runs, 'accuracy');
    expect(ranked.map((entry) => entry.summary.modelName)).toEqual(['A', 'C', 'B']);
    expect(ranked[0]?.rank).toBe(1);
  });

  it('orders ascending for a lower-is-better metric', () => {
    expect(rankRuns(runs, 'costPerTest').map((entry) => entry.summary.modelName)).toEqual([
      'B',
      'C',
      'A',
    ]);
  });

  /** A run with no value for the metric is not the cheapest or the fastest —
   * it is simply not in this ranking. */
  it('drops runs with no value for the metric rather than ranking them last', () => {
    const unpriced = summary({ runId: 'd', modelName: 'D' });
    const stripped: RunSummary = {
      ...unpriced,
      metrics: {
        ...unpriced.metrics,
        cost: { ...unpriced.metrics.cost, costPerTest: null },
      },
    };

    const ranked = rankRuns([...runs, stripped], 'costPerTest');
    expect(ranked).toHaveLength(3);
    expect(ranked.some((entry) => entry.summary.modelName === 'D')).toBe(false);
  });

  it('describes each metric with a direction', () => {
    expect(METRIC_DESCRIPTORS.accuracy.direction).toBe('higher');
    expect(METRIC_DESCRIPTORS.costPerTest.direction).toBe('lower');
    expect(METRIC_DESCRIPTORS.brierScore.direction).toBe('lower');
  });

  it('excludes mock-provider runs from formal benchmark views', () => {
    const mock = summary({ runId: 'mock', provider: 'mock', modelName: 'Mock' });
    const openai = summary({
      runId: 'real',
      provider: 'openai',
      model: 'gpt-real',
      modelName: 'Real model',
    });

    expect(formalBenchmarkRuns([mock, openai]).map((run) => run.runId)).toEqual(['real']);
  });
});

describe('model × prompt matrix', () => {
  it('produces a cell for every pairing, null where none was run', () => {
    const matrix = buildModelPromptMatrix([
      summary({ runId: 'a', modelConfigId: 'm1', promptId: 'p1', accuracy: 0.8 }),
      summary({ runId: 'b', modelConfigId: 'm2', promptId: 'p2', accuracy: 0.6 }),
    ]);

    expect(matrix.models).toHaveLength(2);
    expect(matrix.prompts).toHaveLength(2);
    expect(matrix.cells).toHaveLength(4);
    expect(matrix.cells.filter((cell) => cell.value === null)).toHaveLength(2);
  });

  it('keeps the most recent run when a pairing was run twice', () => {
    const matrix = buildModelPromptMatrix([
      summary({
        runId: 'old',
        modelConfigId: 'm1',
        promptId: 'p1',
        accuracy: 0.3,
        finishedAt: '2026-01-01T00:00:00.000Z',
      }),
      summary({
        runId: 'new',
        modelConfigId: 'm1',
        promptId: 'p1',
        accuracy: 0.9,
        finishedAt: '2026-06-01T00:00:00.000Z',
      }),
    ]);

    expect(matrix.cells[0]?.runId).toBe('new');
    expect(matrix.cells[0]?.value).toBeCloseTo(0.9, 5);
  });
});

describe('dashboard highlights', () => {
  it('names a best configuration for each headline card', () => {
    const highlights = dashboardHighlights([
      summary({ runId: 'a', modelName: 'A', accuracy: 0.9, costPerTest: 0.01 }),
      summary({ runId: 'b', modelName: 'B', accuracy: 0.5, costPerTest: 0.001 }),
    ]);

    expect(highlights.find((item) => item.id === 'best-accuracy')?.summary?.modelName).toBe('A');
    expect(highlights.find((item) => item.id === 'cheapest')?.summary?.modelName).toBe('B');
  });

  it('returns empty highlights rather than failing on no runs', () => {
    const highlights = dashboardHighlights([]);
    expect(highlights).toHaveLength(6);
    expect(highlights.every((item) => item.summary === null)).toBe(true);
  });
});

describe('pareto front', () => {
  it('marks points nothing beats on both axes', () => {
    const points = paretoFront(
      [
        summary({ runId: 'cheap', modelName: 'cheap', accuracy: 0.6, costPerTest: 0.001 }),
        summary({ runId: 'accurate', modelName: 'accurate', accuracy: 0.9, costPerTest: 0.02 }),
        summary({ runId: 'dominated', modelName: 'dominated', accuracy: 0.5, costPerTest: 0.03 }),
      ],
      'costPerTest',
      'accuracy',
    );

    const front = points.filter((point) => point.onFront).map((point) => point.summary.modelName);

    expect(front).toContain('cheap');
    expect(front).toContain('accurate');
    expect(front).not.toContain('dominated');
  });

  it('excludes points missing either coordinate', () => {
    const base = summary({ runId: 'a', accuracy: 0.7 });
    const stripped: RunSummary = {
      ...base,
      metrics: { ...base.metrics, cost: { ...base.metrics.cost, costPerTest: null } },
    };

    expect(paretoFront([stripped], 'costPerTest', 'accuracy')).toHaveLength(0);
  });
});
