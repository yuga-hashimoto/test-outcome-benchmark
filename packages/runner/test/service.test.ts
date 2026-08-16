import { afterEach, describe, expect, it } from 'vitest';
import {
  createDataset,
  createModelConfig,
  createPrompt,
  freezeDatasetVersion,
  getRun,
  listRunSummaries,
  migrateDatabase,
  openDatabase,
} from '@tob/db';
import { compareRuns, recomputeRunMetrics, resumeRun, startRun } from '@tob/runner';
import { rankRuns } from '@tob/core';
import { defaultCases, makeCase } from './harness';
import type { DatabaseHandle } from '@tob/db';

const handles: DatabaseHandle[] = [];

const setup = () => {
  const handle = openDatabase(':memory:');
  migrateDatabase(handle);
  handles.push(handle);
  const { db } = handle;

  const dataset = createDataset(db, { name: 'svc' });
  const { version } = freezeDatasetVersion(db, {
    datasetId: dataset.id,
    cases: defaultCases(),
  });
  const prompt = createPrompt(db, { name: 'p', description: '', content: 'Predict.' });
  const model = createModelConfig(db, {
    name: 'm',
    provider: 'mock',
    model: 'mock-thorough',
    settings: { stream: true },
    pricing: {
      currency: 'USD',
      inputPerMillion: 1,
      outputPerMillion: 2,
      cachedInputPerMillion: null,
      reasoningPerMillion: null,
      source: 'test',
      snapshotAt: '2026-01-01T00:00:00.000Z',
    },
  });

  return { handle, db, dataset, version, prompt, model };
};

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
});

describe('startRun', () => {
  it('runs end to end and snapshots the configuration', async () => {
    const { db, version, prompt, model } = setup();

    const result = await startRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      repetitions: 2,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.metrics?.counts.attempted).toBe(8);
    expect(result.run.snapshot.promptContent).toBe('Predict.');
    expect(result.run.snapshot.promptHash).toBe(prompt.contentHash);
    expect(result.run.snapshot.datasetContentHash).toBe(version.contentHash);
    expect(result.run.snapshot.pricing?.inputPerMillion).toBe(1);
  });

  /** A finished run must keep meaning what it meant, so its numbers are read
   * against the text and prices that produced them. */
  it('keeps the snapshot even after the prompt is revised', async () => {
    const { db, version, prompt, model } = setup();

    const result = await startRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      repetitions: 1,
    });

    const { revisePrompt } = await import('@tob/db');
    revisePrompt(db, prompt.id, { content: 'Completely different instructions.' });

    expect(getRun(db, result.run.id)?.snapshot.promptContent).toBe('Predict.');
  });

  it('rejects an unknown dataset version, model or prompt', async () => {
    const { db, version, prompt, model } = setup();

    await expect(
      startRun(db, { datasetVersionId: 'nope', modelConfigId: model.id, promptId: prompt.id }),
    ).rejects.toThrowError(/dataset version/);

    await expect(
      startRun(db, { datasetVersionId: version.id, modelConfigId: 'nope', promptId: prompt.id }),
    ).rejects.toThrowError(/model configuration/);

    await expect(
      startRun(db, { datasetVersionId: version.id, modelConfigId: model.id, promptId: 'nope' }),
    ).rejects.toThrowError(/prompt/);
  });

  it('reports progress for every attempt', async () => {
    const { db, version, prompt, model } = setup();
    const seen: number[] = [];

    await startRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      repetitions: 1,
      onProgress: (progress) => seen.push(progress.completed),
    });

    expect(seen).toHaveLength(4);
    expect(Math.max(...seen)).toBe(4);
  });

  it('applies the balanced distribution as a view over the same version', async () => {
    const { db, dataset } = setup();
    const { version } = freezeDatasetVersion(db, {
      datasetId: dataset.id,
      cases: [
        makeCase('p1', 'PASS'),
        makeCase('p2', 'PASS'),
        makeCase('p3', 'PASS'),
        makeCase('f1', 'FAIL'),
      ],
    });
    const prompt = createPrompt(db, { name: 'p2', description: '', content: 'x' });
    const model = createModelConfig(db, {
      name: 'm2',
      provider: 'mock',
      model: 'mock-lean',
      settings: {},
    });

    const result = await startRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      repetitions: 1,
      distribution: 'balanced',
    });

    expect(result.metrics?.counts.attempted).toBe(2);
  });
});

describe('resumeRun', () => {
  it('is a no-op when the run already finished', async () => {
    const { db, version, prompt, model } = setup();

    const first = await startRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      repetitions: 1,
    });

    const resumed = await resumeRun(db, { runId: first.run.id });

    expect(resumed.executed).toBe(0);
    expect(resumed.skipped).toBe(4);
  });

  it('rejects an unknown run', async () => {
    const { db } = setup();
    await expect(resumeRun(db, { runId: 'nope' })).rejects.toThrowError(/Unknown run/);
  });
});

describe('recomputeRunMetrics', () => {
  it('rescores stored predictions without calling the model again', async () => {
    const { db, version, prompt, model } = setup();

    const first = await startRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      repetitions: 2,
    });

    const recomputed = recomputeRunMetrics(db, first.run.id);

    expect(recomputed.accuracy).toBe(first.metrics?.accuracy);
    expect(recomputed.counts.attempted).toBe(8);
  });

  /**
   * A rescore has no new timing data — recomputing after a scoring change
   * must not look like the run had zero throughput just because this call
   * didn't execute anything.
   */
  it('keeps the previously recorded wall-clock time instead of erasing it', async () => {
    const { db, version, prompt, model } = setup();

    const first = await startRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      repetitions: 2,
    });

    expect(first.metrics?.latency.wallClockMs).not.toBeNull();

    const recomputed = recomputeRunMetrics(db, first.run.id);

    expect(recomputed.latency.wallClockMs).toBe(first.metrics?.latency.wallClockMs);
  });
});

describe('compareRuns', () => {
  it('produces a paired delta over the cases both runs scored', async () => {
    const { db, version, prompt, model } = setup();
    const other = createModelConfig(db, {
      name: 'other',
      provider: 'mock',
      model: 'mock-lean',
      settings: {},
    });

    const baseline = await startRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      repetitions: 2,
    });
    const candidate = await startRun(db, {
      datasetVersionId: version.id,
      modelConfigId: other.id,
      promptId: prompt.id,
      repetitions: 2,
    });

    const comparison = compareRuns(db, baseline.run.id, candidate.run.id);

    expect(comparison.matchedCases).toBe(4);
    expect(comparison.sameDatasetVersion).toBe(true);
    expect(comparison.deltaAccuracy).not.toBeNull();
  });

  it('flags a comparison across different dataset versions', async () => {
    const { db, dataset, version, prompt, model } = setup();
    const second = freezeDatasetVersion(db, {
      datasetId: dataset.id,
      cases: [...defaultCases(), makeCase('c5', 'FAIL')],
    });

    const baseline = await startRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      repetitions: 1,
    });
    const candidate = await startRun(db, {
      datasetVersionId: second.version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      repetitions: 1,
    });

    expect(compareRuns(db, baseline.run.id, candidate.run.id).sameDatasetVersion).toBe(false);
  });

  it('rejects unknown runs', async () => {
    const { db } = setup();
    expect(() => compareRuns(db, 'a', 'b')).toThrowError(/Unknown run/);
  });
});

describe('run summaries', () => {
  it('exposes finished runs to the ranking views with their dataset version', async () => {
    const { db, version, prompt, model } = setup();

    await startRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      repetitions: 1,
    });

    const summaries = listRunSummaries(db);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.datasetVersion).toBe(version.version);
    expect(rankRuns(summaries, 'accuracy')[0]?.rank).toBe(1);
  });
});
