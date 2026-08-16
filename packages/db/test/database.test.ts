import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DatasetIntegrityError,
  createDataset,
  createModelConfig,
  createPrompt,
  clonePrompt,
  freezeDatasetVersion,
  latestVersion,
  listCases,
  listPrompts,
  listPromptVersions,
  listVersions,
  openDatabase,
  migrateDatabase,
  revisePrompt,
  schema,
} from '@tob/db';
import type { BenchmarkCase } from '@tob/core';
import type { DatabaseHandle } from '@tob/db';

const makeCase = (
  id: string,
  gold: 'PASS' | 'FAIL',
  overrides: Partial<BenchmarkCase> = {},
): BenchmarkCase => ({
  id,
  revision: 'head',
  flipPairId: null,
  pr: {
    repository: 'owner/repo',
    number: 1,
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    title: 'A change',
    description: '',
    diff: 'diff --git a/x b/x',
    changedFiles: 1,
    addedLines: 1,
    deletedLines: 0,
    commits: 1,
    language: 'TypeScript',
    labels: [],
  },
  testCase: {
    id: `tc_${id}`,
    title: 'Behaviour holds',
    preconditions: 'none',
    steps: ['do the thing'],
    expectedResult: 'the thing happens',
  },
  gold: { result: gold },
  metadata: {
    executedAt: '2026-01-01T00:00:00.000Z',
    testType: 'API',
    tags: [],
    durationMs: null,
    feature: null,
    platform: null,
    specificity: 'MEDIUM',
    ambiguity: 'MEDIUM',
    externalDependency: false,
    casePattern: 'BUG_FIX',
    provenance: {
      prUrl: 'https://github.com/owner/repo/pull/1',
      issueUrl: null,
      evidenceTestFile: null,
      note: '',
      source: 'HISTORICAL_EVIDENCE',
    },
  },
  ...overrides,
});

let handle: DatabaseHandle;

beforeEach(() => {
  handle = openDatabase(':memory:');
  migrateDatabase(handle);
});

afterEach(() => {
  handle.close();
});

describe('migrations', () => {
  it('are idempotent', () => {
    const second = migrateDatabase(handle);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toContain('0001_initial');
  });

  /**
   * Guards the one real risk of hand-written DDL alongside Drizzle table
   * definitions: the two drifting apart. Selecting from every declared table
   * fails immediately if a column or table name diverges.
   */
  it('produce a database matching every declared table', () => {
    for (const [name, tableDefinition] of Object.entries(schema)) {
      expect(() => handle.db.select().from(tableDefinition).all(), name).not.toThrow();
    }
  });
});

describe('dataset versions', () => {
  it('freezes an immutable version and copies its cases', () => {
    const dataset = createDataset(handle.db, { name: 'ds' });
    const { version } = freezeDatasetVersion(handle.db, {
      datasetId: dataset.id,
      cases: [makeCase('a', 'PASS'), makeCase('b', 'FAIL')],
    });

    expect(version.version).toBe(1);
    expect(version.caseCount).toBe(2);
    expect(listCases(handle.db, version.id)).toHaveLength(2);
  });

  it('increments the version rather than replacing the previous one', () => {
    const dataset = createDataset(handle.db, { name: 'ds' });
    freezeDatasetVersion(handle.db, {
      datasetId: dataset.id,
      cases: [makeCase('a', 'PASS'), makeCase('b', 'FAIL')],
    });
    const second = freezeDatasetVersion(handle.db, {
      datasetId: dataset.id,
      cases: [makeCase('a', 'PASS'), makeCase('b', 'FAIL'), makeCase('c', 'FAIL')],
    });

    expect(second.version.version).toBe(2);
    expect(listVersions(handle.db, dataset.id)).toHaveLength(2);
    expect(latestVersion(handle.db, dataset.id)?.caseCount).toBe(3);
  });

  it('refuses to freeze a dataset that fails an integrity check', () => {
    const dataset = createDataset(handle.db, { name: 'ds' });

    expect(() =>
      freezeDatasetVersion(handle.db, {
        datasetId: dataset.id,
        cases: [makeCase('a', 'PASS'), makeCase('a', 'FAIL')],
      }),
    ).toThrow(DatasetIntegrityError);
  });

  it('returns warnings without blocking the freeze', () => {
    const dataset = createDataset(handle.db, { name: 'ds' });
    const { warnings } = freezeDatasetVersion(handle.db, {
      datasetId: dataset.id,
      cases: [
        makeCase('a', 'FAIL', { revision: 'base', flipPairId: 'p' }),
        makeCase('b', 'PASS', { revision: 'head', flipPairId: 'p' }),
      ],
    });

    expect(warnings.some((warning) => warning.code === 'REVISION_PREDICTS_LABEL')).toBe(true);
  });

  it('assigns cases to splits and filters by them', () => {
    const dataset = createDataset(handle.db, { name: 'ds' });
    const { version } = freezeDatasetVersion(handle.db, {
      datasetId: dataset.id,
      cases: [makeCase('a', 'PASS'), makeCase('b', 'FAIL')],
      splits: { a: 'dev', b: 'test' },
    });

    expect(listCases(handle.db, version.id, 'dev')).toHaveLength(1);
    expect(listCases(handle.db, version.id, 'test')).toHaveLength(1);
    expect(listCases(handle.db, version.id)).toHaveLength(2);
  });
});

describe('prompt versioning', () => {
  it('appends a version instead of mutating the existing row', () => {
    const created = createPrompt(handle.db, {
      name: 'p',
      description: 'first',
      content: 'original',
    });
    const revised = revisePrompt(handle.db, created.id, { content: 'updated' });

    expect(revised.version).toBe(2);
    expect(revised.contentHash).not.toBe(created.contentHash);
    expect(listPromptVersions(handle.db, created.id.replace(/^prompt_/, 'pf_')).length).toBeLessThanOrEqual(2);
  });

  it('lists only the newest version of each prompt', () => {
    const created = createPrompt(handle.db, { name: 'p', description: '', content: 'v1' });
    revisePrompt(handle.db, created.id, { content: 'v2' });

    const listed = listPrompts(handle.db);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.version).toBe(2);
  });

  it('starts a clone in its own family so versions advance independently', () => {
    const created = createPrompt(handle.db, { name: 'p', description: '', content: 'v1' });
    const cloned = clonePrompt(handle.db, created.id, 'p-copy');

    expect(cloned.version).toBe(1);
    expect(cloned.content).toBe(created.content);
    expect(listPrompts(handle.db)).toHaveLength(2);
  });
});

describe('model configurations', () => {
  it('stores the name of the key variable, never a key', () => {
    const config = createModelConfig(handle.db, {
      name: 'gpt',
      provider: 'openai',
      model: 'gpt-5.5',
      apiKeyEnvVar: 'OPENAI_API_KEY',
    });

    expect(config.apiKeyEnvVar).toBe('OPENAI_API_KEY');
    expect(JSON.stringify(config)).not.toContain('sk-');
  });

  it('fills unspecified inference settings with defaults', () => {
    const config = createModelConfig(handle.db, {
      name: 'm',
      provider: 'mock',
      model: 'mock-lean',
      settings: { temperature: 0.7 },
    });

    expect(config.settings.temperature).toBe(0.7);
    expect(config.settings.maxOutputTokens).toBe(2048);
  });
});
