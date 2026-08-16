import {
  createDataset,
  createModelConfig,
  createPrompt,
  createRun,
  freezeDatasetVersion,
  listCases,
  migrateDatabase,
  openDatabase,
} from '@tob/db';
import { defaultRunConfiguration } from '@tob/core';
import type { BenchmarkCase, BenchmarkRun, ModelConfiguration, Prompt } from '@tob/core';
import type { DatabaseHandle } from '@tob/db';

export const makeCase = (
  id: string,
  gold: 'PASS' | 'FAIL',
  overrides: Partial<BenchmarkCase> = {},
): BenchmarkCase => ({
  id,
  revision: gold === 'FAIL' ? 'base' : 'head',
  flipPairId: null,
  pr: {
    repository: `owner/repo${id.slice(-1)}`,
    number: 1,
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    title: 'Clamp the range',
    description: 'Handles the empty case.',
    diff: '--- a/src/range.ts\n+++ b/src/range.ts\n@@\n-  return end - start;\n+  return Math.max(0, end - start);',
    changedFiles: 1,
    addedLines: 1,
    deletedLines: 1,
    commits: 1,
    language: 'TypeScript',
    labels: [],
  },
  testCase: {
    id: `tc_${id}`,
    title: 'Empty range reports zero length',
    preconditions: 'A range helper is available.',
    steps: ['Create a range whose end precedes its start.', 'Read the reported length.'],
    expectedResult: 'The reported length is zero.',
  },
  gold: { result: gold },
  metadata: {
    executedAt: '2026-01-01T00:00:00.000Z',
    testType: 'BUSINESS_LOGIC',
    tags: [],
    durationMs: null,
    feature: 'ranges',
    platform: 'node',
    specificity: 'HIGH',
    ambiguity: 'LOW',
    externalDependency: false,
    casePattern: 'BUG_FIX',
    provenance: {
      prUrl: 'https://github.com/owner/repo/pull/1',
      issueUrl: null,
      evidenceTestFile: null,
      note: '',
    },
  },
  ...overrides,
});

export const defaultCases = (): BenchmarkCase[] => [
  makeCase('c1', 'PASS'),
  makeCase('c2', 'FAIL'),
  makeCase('c3', 'PASS'),
  makeCase('c4', 'FAIL'),
];

export interface Harness {
  readonly handle: DatabaseHandle;
  readonly run: BenchmarkRun;
  readonly cases: BenchmarkCase[];
  readonly prompt: Prompt;
  readonly modelConfig: ModelConfiguration;
}

export interface HarnessOptions {
  readonly repetitions?: number;
  readonly maxAttempts?: number;
  readonly concurrency?: number;
  readonly cases?: BenchmarkCase[];
}

export const createHarness = (options: HarnessOptions = {}): Harness => {
  const handle = openDatabase(':memory:');
  migrateDatabase(handle);
  const { db } = handle;

  const dataset = createDataset(db, { name: 'harness' });
  const { version } = freezeDatasetVersion(db, {
    datasetId: dataset.id,
    cases: options.cases ?? defaultCases(),
  });

  const prompt = createPrompt(db, {
    name: 'harness-prompt',
    description: '',
    content: 'Predict the outcome.',
  });

  const modelConfig = createModelConfig(db, {
    name: 'harness-model',
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

  const config = defaultRunConfiguration({
    datasetVersionId: version.id,
    modelConfigId: modelConfig.id,
    promptId: prompt.id,
    repetitions: options.repetitions ?? 1,
    maxAttempts: options.maxAttempts ?? 3,
    concurrency: options.concurrency ?? 2,
  });

  const cases = listCases(db, version.id);

  const run = createRun(db, {
    name: 'harness run',
    config,
    snapshot: {
      datasetId: dataset.id,
      datasetName: dataset.name,
      datasetVersion: version.version,
      datasetContentHash: version.contentHash,
      modelName: modelConfig.name,
      provider: modelConfig.provider,
      model: modelConfig.model,
      settings: modelConfig.settings,
      pricing: modelConfig.pricing,
      promptName: prompt.name,
      promptVersion: prompt.version,
      promptHash: prompt.contentHash,
      promptContent: prompt.content,
      benchmarkGitSha: null,
    },
    totalPredictions: cases.length * config.repetitions,
  });

  return { handle, run, cases, prompt, modelConfig };
};
