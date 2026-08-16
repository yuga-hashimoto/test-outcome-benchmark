import { afterEach, describe, expect, it } from 'vitest';
import {
  createDataset,
  createModelConfig,
  createPrompt,
  freezeDatasetVersion,
  getRun,
  listPredictions,
  migrateDatabase,
  openDatabase,
} from '@tob/db';
import { createAdapter } from '@tob/providers';
import { exportCases, importRun, runSweep } from '@tob/runner';
import { defaultCases } from './harness';
import type { DatabaseHandle } from '@tob/db';

const handles: DatabaseHandle[] = [];

const setup = () => {
  const handle = openDatabase(':memory:');
  migrateDatabase(handle);
  handles.push(handle);
  const { db } = handle;

  const dataset = createDataset(db, { name: 'ext' });
  const { version } = freezeDatasetVersion(db, { datasetId: dataset.id, cases: defaultCases() });
  const prompt = createPrompt(db, { name: 'p', description: '', content: 'Predict.' });
  const model = createModelConfig(db, {
    name: 'harness-model',
    provider: 'external',
    model: 'some-model',
    settings: {},
  });

  return { db, version, prompt, model };
};

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
});

describe('exporting cases', () => {
  it('renders one entry per case and repetition', () => {
    const { db, version, prompt } = setup();

    const exported = exportCases(db, {
      datasetVersionId: version.id,
      promptId: prompt.id,
      repetitions: 2,
    });

    expect(exported).toHaveLength(8);
    expect(exported[0]?.system).toContain('Predict.');
    expect(exported[0]?.user).toContain('Revision under test');
  });

  /** The export is meant to be handed to a third party, so this is the check
   * that matters most about it. */
  it('contains no gold verdict anywhere', () => {
    const { db, version, prompt } = setup();

    const serialised = JSON.stringify(
      exportCases(db, { datasetVersionId: version.id, promptId: prompt.id }),
    );

    expect(serialised).not.toContain('"gold"');
    expect(serialised).not.toContain('goldResult');
  });

  it('asks the same question a native run would', () => {
    const { db, version, prompt } = setup();

    const first = exportCases(db, {
      datasetVersionId: version.id,
      promptId: prompt.id,
      contextStrategy: 'TEST_ONLY',
    });
    const second = exportCases(db, {
      datasetVersionId: version.id,
      promptId: prompt.id,
      contextStrategy: 'TEST_PLUS_DIFF',
    });

    expect(first[0]?.inputHash).not.toBe(second[0]?.inputHash);
    expect(first[0]?.user).not.toContain('```diff');
    expect(second[0]?.user).toContain('```diff');
  });
});

describe('importing a run', () => {
  it('scores externally produced answers like any other run', () => {
    const { db, version, prompt, model } = setup();
    const cases = exportCases(db, { datasetVersionId: version.id, promptId: prompt.id });

    const result = importRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      predictions: cases.map((item) => ({
        caseId: item.caseId,
        verdict: 'PASS',
        confidence: 0.7,
        reason: 'because',
      })),
    });

    expect(result.imported).toBe(4);
    expect(result.missing).toBe(0);
    expect(result.unmatched).toEqual([]);
    expect(result.metrics.counts.resolved).toBe(4);
    /** defaultCases is two PASS and two FAIL, so answering PASS scores half. */
    expect(result.metrics.accuracy).toBeCloseTo(0.5, 10);
    expect(getRun(db, result.run.id)?.status).toBe('COMPLETED');
  });

  /**
   * The bug this guards against: a harness that only answers the easy cases
   * must not look like one that answered everything and got it all right.
   * Answering 1 of 4 correctly is 25% accuracy, not 100% — the 3 unanswered
   * cases stay in the denominator as recorded failures, not as absent rows a
   * naive `predictions.length` could undercount.
   */
  it('reports cases the harness never answered instead of hiding them', () => {
    const { db, version, prompt, model } = setup();

    const result = importRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      predictions: [{ caseId: 'c1', verdict: 'PASS', confidence: 0.9 }],
    });

    expect(result.imported).toBe(1);
    expect(result.missing).toBe(3);
    expect(result.metrics.counts.attempted).toBe(4);
    expect(result.metrics.counts.resolved).toBe(1);
    expect(result.metrics.accuracy).toBeCloseTo(0.25, 10);
    expect(result.metrics.strictAccuracy).toBeCloseTo(0.25, 10);
  });

  it('ignores answers for cases outside the dataset version and says so', () => {
    const { db, version, prompt, model } = setup();

    const result = importRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      predictions: [
        { caseId: 'c1', verdict: 'PASS' },
        { caseId: 'not-a-case', verdict: 'PASS' },
      ],
    });

    expect(result.imported).toBe(1);
    expect(result.unmatched).toEqual(['not-a-case']);
  });

  /**
   * setup() has 4 cases. Two get an explicit unusable verdict; the other two
   * are never answered at all. Both kinds are contract violations — an
   * unanswered case is scored exactly like one the harness answered badly,
   * not silently excluded from the denominator.
   */
  it('records an unusable verdict as an output-contract violation, same as never answering', () => {
    const { db, version, prompt, model } = setup();

    const result = importRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      predictions: [
        { caseId: 'c1', verdict: 'MAYBE' },
        { caseId: 'c2', verdict: null, error: 'harness timed out' },
      ],
    });

    expect(result.imported).toBe(2);
    expect(result.missing).toBe(2);
    expect(result.metrics.counts.attempted).toBe(4);
    expect(result.metrics.counts.contractViolations).toBe(4);
    expect(result.metrics.counts.resolved).toBe(0);
    /** FORCED mode: 0 correct of 4 attempted is a defined 0%, not "no data". */
    expect(result.metrics.accuracy).toBe(0);
    expect(result.metrics.strictAccuracy).toBe(0);
  });

  it('drops a confidence outside 0-1 but keeps the verdict', () => {
    const { db, version, prompt, model } = setup();

    const result = importRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      predictions: [{ caseId: 'c1', verdict: 'PASS', confidence: 95 }],
    });

    const [stored] = listPredictions(db, result.run.id);
    expect(stored?.predictedVerdict).toBe('PASS');
    expect(stored?.confidence).toBeNull();
  });

  /**
   * A harness that could browse the source repo is not the same experiment
   * as one that could not, even if both answer the same exported cases —
   * this is part of the condition, not incidental metadata.
   */
  it('records the harness conditions in the run snapshot when given', () => {
    const { db, version, prompt, model } = setup();

    const result = importRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      predictions: [{ caseId: 'c1', verdict: 'PASS' }],
      harnessConditions: {
        tool: 'OpenCode CLI via CAO',
        toolPolicy: 'No gh, no web search, no repository browsing.',
        instructions: 'Answer from the exported prompt only.',
      },
    });

    expect(result.run.snapshot.harnessConditions).toEqual({
      tool: 'OpenCode CLI via CAO',
      toolPolicy: 'No gh, no web search, no repository browsing.',
      instructions: 'Answer from the exported prompt only.',
    });
  });

  it('leaves harness conditions null when none are given', () => {
    const { db, version, prompt, model } = setup();

    const result = importRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      predictions: [{ caseId: 'c1', verdict: 'PASS' }],
    });

    expect(result.run.snapshot.harnessConditions).toBeNull();
  });

  it('infers the repetition count from the answers', () => {
    const { db, version, prompt, model } = setup();

    const result = importRun(db, {
      datasetVersionId: version.id,
      modelConfigId: model.id,
      promptId: prompt.id,
      predictions: [
        { caseId: 'c1', repetition: 0, verdict: 'PASS' },
        { caseId: 'c1', repetition: 1, verdict: 'FAIL' },
      ],
    });

    expect(result.run.config.repetitions).toBe(2);
    expect(result.metrics.stability.repetitions).toBe(2);
  });
});

describe('external provider', () => {
  /** Starting a run against imported answers would silently produce nothing;
   * refusing makes the mistake obvious at the first call. */
  it('refuses to be called, pointing at import-run instead', () => {
    const adapter = createAdapter({
      id: 'm',
      name: 'external',
      provider: 'external',
      model: 'x',
      settings: {
        temperature: null,
        topP: null,
        maxOutputTokens: null,
        reasoningEffort: null,
        seed: null,
        stream: false,
      },
      baseUrl: null,
      apiKeyEnvVar: null,
      pricing: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(() =>
      adapter.complete({
        model: 'x',
        system: '',
        user: '',
        settings: {
          temperature: null,
          topP: null,
          maxOutputTokens: null,
          reasoningEffort: null,
          seed: null,
          stream: false,
        },
        signal: new AbortController().signal,
        timeoutMs: 1000,
        requestKey: 'k',
      }),
    ).toThrowError(/import-run/);
  });
});

describe('sweep', () => {
  it('runs every combination of model, prompt and context strategy', async () => {
    const { db, version, prompt } = setup();
    const modelA = createModelConfig(db, {
      name: 'a',
      provider: 'mock',
      model: 'mock-lean',
      settings: {},
    });
    const modelB = createModelConfig(db, {
      name: 'b',
      provider: 'mock',
      model: 'mock-thorough',
      settings: {},
    });

    const result = await runSweep(db, {
      datasetVersionId: version.id,
      modelConfigIds: [modelA.id, modelB.id],
      promptIds: [prompt.id],
      contextStrategies: ['TEST_ONLY', 'TEST_PLUS_DIFF'],
      repetitions: 1,
    });

    expect(result.cells).toHaveLength(4);
    expect(result.completed).toBe(4);
    expect(result.failed).toBe(0);
  });

  /** Losing finished cells because a later one failed would be the wrong trade. */
  it('records a failing cell and keeps going', async () => {
    const { db, version, prompt } = setup();
    const working = createModelConfig(db, {
      name: 'ok',
      provider: 'mock',
      model: 'mock-lean',
      settings: {},
    });

    const result = await runSweep(db, {
      datasetVersionId: version.id,
      modelConfigIds: ['does-not-exist', working.id],
      promptIds: [prompt.id],
      repetitions: 1,
    });

    expect(result.failed).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.cells[0]?.error).toMatch(/model configuration/);
    expect(result.cells[1]?.metrics).not.toBeNull();
  });
});
