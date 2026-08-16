import { describe, expect, it } from 'vitest';
import {
  applyDistribution,
  checkDatasetIntegrity,
  hashCases,
  hashPromptContent,
  parseBenchmarkCases,
} from '@tob/core';
import { benchmarkCase } from './helpers';

const withGold = (id: string, result: 'PASS' | 'FAIL', overrides = {}) =>
  benchmarkCase({ id, gold: { result }, ...overrides });

describe('case schema', () => {
  it('accepts a well formed case and fills optional fields', () => {
    const [parsed] = parseBenchmarkCases([
      {
        id: 'c1',
        revision: 'head',
        pr: {
          repository: 'owner/repo',
          number: 5,
          baseSha: 'a'.repeat(40),
          headSha: 'b'.repeat(40),
          title: 't',
          description: '',
          diff: 'diff',
        },
        testCase: { id: 'tc', title: 't', preconditions: '', steps: ['s'], expectedResult: 'r' },
        gold: { result: 'PASS' },
        metadata: {
          executedAt: '2026-01-01T00:00:00.000Z',
          testType: 'API',
          casePattern: 'BUG_FIX',
          provenance: { prUrl: 'https://github.com/owner/repo/pull/5' },
        },
      },
    ]);

    expect(parsed?.flipPairId).toBeNull();
    expect(parsed?.pr.labels).toEqual([]);
    expect(parsed?.metadata.provenance.issueUrl).toBeNull();
  });

  it('rejects a repository that is not owner/repo', () => {
    expect(() =>
      parseBenchmarkCases([
        {
          id: 'c1',
          revision: 'head',
          pr: {
            repository: 'not-a-repo',
            number: 5,
            baseSha: 'a'.repeat(40),
            headSha: 'b'.repeat(40),
            title: 't',
            description: '',
            diff: 'd',
          },
          testCase: { id: 'tc', title: 't', preconditions: '', steps: ['s'], expectedResult: 'r' },
          gold: { result: 'PASS' },
          metadata: {
            executedAt: '2026-01-01T00:00:00.000Z',
            testType: 'API',
            casePattern: 'BUG_FIX',
            provenance: { prUrl: 'https://github.com/owner/repo/pull/5' },
          },
        },
      ]),
    ).toThrow();
  });
});

describe('dataset integrity', () => {
  it('accepts a dataset with both classes and well formed flip pairs', () => {
    const report = checkDatasetIntegrity([
      withGold('a', 'FAIL', { revision: 'base', flipPairId: 'p1' }),
      withGold('b', 'PASS', { revision: 'head', flipPairId: 'p1' }),
      withGold('c', 'PASS', { revision: 'base' }),
      withGold('d', 'FAIL', { revision: 'head' }),
    ]);

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('rejects duplicate case ids', () => {
    const report = checkDatasetIntegrity([
      withGold('a', 'PASS'),
      withGold('a', 'FAIL'),
    ]);

    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'DUPLICATE_CASE_ID')).toBe(true);
  });

  it('rejects a flip pair that does not flip', () => {
    const report = checkDatasetIntegrity([
      withGold('a', 'PASS', { revision: 'base', flipPairId: 'p1' }),
      withGold('b', 'PASS', { revision: 'head', flipPairId: 'p1' }),
      withGold('c', 'FAIL'),
    ]);

    expect(report.issues.some((issue) => issue.code === 'FLIP_PAIR_NO_FLIP')).toBe(true);
  });

  it('rejects a single class dataset', () => {
    const report = checkDatasetIntegrity([withGold('a', 'PASS'), withGold('b', 'PASS')]);

    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'SINGLE_CLASS_DATASET')).toBe(true);
  });

  /**
   * The degenerate dataset this benchmark has to avoid: if every base case
   * fails and every head case passes, "answer by revision" scores 100% without
   * reading the test.
   */
  it('warns when the revision alone determines the label', () => {
    const report = checkDatasetIntegrity([
      withGold('a', 'FAIL', { revision: 'base', flipPairId: 'p1' }),
      withGold('b', 'PASS', { revision: 'head', flipPairId: 'p1' }),
      withGold('c', 'FAIL', { revision: 'base', flipPairId: 'p2' }),
      withGold('d', 'PASS', { revision: 'head', flipPairId: 'p2' }),
    ]);

    expect(report.ok).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'REVISION_PREDICTS_LABEL')).toBe(true);
  });
});

describe('distribution views', () => {
  const cases = [
    withGold('a', 'PASS'),
    withGold('b', 'PASS'),
    withGold('c', 'PASS'),
    withGold('d', 'FAIL'),
  ];

  it('leaves the natural distribution untouched', () => {
    expect(applyDistribution(cases, 'natural')).toHaveLength(4);
  });

  it('downsamples the majority class for the balanced view', () => {
    const balanced = applyDistribution(cases, 'balanced');

    expect(balanced).toHaveLength(2);
    expect(balanced.filter((item) => item.gold.result === 'PASS')).toHaveLength(1);
    expect(balanced.filter((item) => item.gold.result === 'FAIL')).toHaveLength(1);
  });

  it('produces the same balanced view every time', () => {
    expect(applyDistribution(cases, 'balanced')).toEqual(applyDistribution(cases, 'balanced'));
  });
});

describe('hashing', () => {
  it('gives identical prompt text an identical hash', () => {
    expect(hashPromptContent('abc')).toBe(hashPromptContent('abc'));
    expect(hashPromptContent('abc')).not.toBe(hashPromptContent('abd'));
  });

  it('hashes a case set independently of ordering', () => {
    const a = withGold('a', 'PASS');
    const b = withGold('b', 'FAIL');
    expect(hashCases([b, a])).toBe(hashCases([a, b]));
  });

  it('changes when a case changes content under the same id', () => {
    const original = withGold('a', 'PASS');
    const mutated = withGold('a', 'FAIL');
    expect(hashCases([original])).not.toBe(hashCases([mutated]));
  });
});
