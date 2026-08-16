import { afterEach, describe, expect, it } from 'vitest';
import { aggregateRunMetrics } from '@tob/core';
import {
  finishHumanSession,
  listCases,
  listDatasets,
  listHumanResponses,
  listHumanSessions,
  listModelConfigs,
  listPrompts,
  listVersions,
  migrateDatabase,
  openDatabase,
  recordHumanResponse,
  startHumanSession,
} from '@tob/db';
import { SEED_PROMPTS, loadCaseFiles, renderRunReport, seedDatabase } from '@tob/cli';
import { interval, money, percent, table } from '@tob/cli/format';
import type { DatabaseHandle } from '@tob/db';

const handles: DatabaseHandle[] = [];

const fresh = (): DatabaseHandle => {
  const handle = openDatabase(':memory:');
  migrateDatabase(handle);
  handles.push(handle);
  return handle;
};

afterEach(() => {
  while (handles.length > 0) handles.pop()?.close();
});

describe('seeding', () => {
  it('loads the bundled dataset, prompts and mock models', () => {
    const { db } = fresh();
    const result = seedDatabase(db, { dataDirectory: 'data/oss' });

    expect(result.caseCount).toBeGreaterThan(0);
    expect(result.repositories).toBeGreaterThan(10);
    expect(result.promptsCreated).toBe(SEED_PROMPTS.length);
    expect(result.modelsCreated).toBe(4);
    expect(listDatasets(db)).toHaveLength(1);
    expect(listPrompts(db)).toHaveLength(SEED_PROMPTS.length);
    expect(listModelConfigs(db)).toHaveLength(4);
  });

  it('is idempotent: seeding twice does not duplicate anything', () => {
    const { db } = fresh();
    seedDatabase(db, { dataDirectory: 'data/oss' });
    const second = seedDatabase(db, { dataDirectory: 'data/oss' });

    expect(second.skipped).toBe(true);
    expect(second.promptsCreated).toBe(0);
    expect(second.modelsCreated).toBe(0);
    expect(listVersions(db, listDatasets(db)[0]!.id)).toHaveLength(1);
  });

  it('freezes an additional version when forced', () => {
    const { db } = fresh();
    seedDatabase(db, { dataDirectory: 'data/oss' });
    const forced = seedDatabase(db, { dataDirectory: 'data/oss', force: true });

    expect(forced.skipped).toBe(false);
    expect(forced.datasetVersion).toBe(2);
    expect(listVersions(db, listDatasets(db)[0]!.id)).toHaveLength(2);
  });

  /** Cases from one pull request must not straddle a split, or near-identical
   * context ends up on both sides of the divide. */
  it('keeps every case from a pull request in the same split', () => {
    const { db } = fresh();
    seedDatabase(db, { dataDirectory: 'data/oss' });

    const version = listVersions(db, listDatasets(db)[0]!.id)[0]!;
    const clustersIn = (split: 'dev' | 'test'): Set<string> =>
      new Set(
        listCases(db, version.id, split).map((item) => `${item.pr.repository}#${item.pr.number}`),
      );

    const dev = clustersIn('dev');
    const test = clustersIn('test');

    expect(dev.size + test.size).toBeGreaterThan(0);
    for (const cluster of dev) expect(test.has(cluster), cluster).toBe(false);
  });
});

describe('bundled dataset', () => {
  const cases = loadCaseFiles('data/oss');

  it('parses every shipped case file against the schema', () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
  });

  /**
   * The property the whole benchmark rests on: knowing which revision is under
   * test must not be enough to know the answer.
   */
  it('does not let the revision alone determine the gold verdict', () => {
    const counts = { base: { PASS: 0, FAIL: 0 }, head: { PASS: 0, FAIL: 0 } };
    for (const item of cases) counts[item.revision][item.gold.result] += 1;

    expect(counts.base.PASS).toBeGreaterThan(0);
    expect(counts.base.FAIL).toBeGreaterThan(0);
    expect(counts.head.PASS).toBeGreaterThan(0);
    expect(counts.head.FAIL).toBeGreaterThan(0);
  });

  it('carries provenance for every gold label so it can be re-checked', () => {
    for (const item of cases) {
      expect(item.metadata.provenance.prUrl).toMatch(/^https:\/\/github\.com\/.+\/pull\/\d+$/);
    }
  });

  it('never leaks the outcome into the test case prose', () => {
    const banned = /\b(regression|hotfix)\b/i;
    for (const item of cases) {
      const prose = [
        item.testCase.title,
        item.testCase.preconditions,
        ...item.testCase.steps,
        item.testCase.expectedResult,
      ].join(' ');
      expect(prose, item.id).not.toMatch(banned);
    }
  });

  it('pairs every flip pair as exactly two cases that disagree', () => {
    const pairs = new Map<string, typeof cases>();
    for (const item of cases) {
      if (item.flipPairId === null) continue;
      pairs.set(item.flipPairId, [...(pairs.get(item.flipPairId) ?? []), item]);
    }

    expect(pairs.size).toBeGreaterThan(0);
    for (const [id, members] of pairs) {
      expect(members, id).toHaveLength(2);
      expect(members[0]!.gold.result, id).not.toBe(members[1]!.gold.result);
    }
  });
});

describe('formatting', () => {
  it('renders missing values as an em dash rather than zero', () => {
    expect(percent(null)).toBe('—');
    expect(money(null)).toBe('—');
    expect(interval(null, null, null)).toBe('—');
  });

  it('renders an interval alongside its estimate', () => {
    expect(interval(0.723, 0.641, 0.798)).toBe('72.3% (64.1%–79.8%)');
  });

  it('falls back to the estimate alone when there is no interval', () => {
    expect(interval(0.5, null, null)).toBe('50.0%');
  });

  it('aligns table columns', () => {
    const rendered = table([
      ['a', 'long value'],
      ['bbbb', 'x'],
    ]);
    expect(rendered.split('\n')[0]).toBe('a     long value');
  });
});

describe('run report', () => {
  it('leads with accuracy and states both denominators', () => {
    const metrics = aggregateRunMetrics(
      [
        { ...basePrediction(), goldVerdict: 'PASS', predictedVerdict: 'PASS' },
        { ...basePrediction(), goldVerdict: 'FAIL', predictedVerdict: 'PASS' },
      ],
      { bootstrapResamples: 10 },
    );

    const report = renderRunReport(metrics, 'demo run');

    expect(report).toContain('demo run');
    expect(report).toContain('Accuracy');
    expect(report).toContain('Strict accuracy');
    expect(report).toContain('Confusion matrix');
    expect(report).toContain('Safe skip analysis');
  });

  /** Timing present but no first-token time: the response simply was not streamed. */
  it('says so when nothing was streamed rather than showing a blank latency', () => {
    const metrics = aggregateRunMetrics([basePrediction()], { bootstrapResamples: 10 });

    expect(renderRunReport(metrics, 'demo')).toContain('no response was streamed');
  });

  /** No timing at all is a different situation, and saying "not streamed" would
   * misattribute it — an imported run has no per-request timing to begin with. */
  it('distinguishes a run with no timing at all from a non-streamed one', () => {
    const metrics = aggregateRunMetrics([{ ...basePrediction(), latency: null }], {
      bootstrapResamples: 10,
    });

    const report = renderRunReport(metrics, 'demo');
    expect(report).toContain('No timing was recorded for this run');
    expect(report).not.toContain('no response was streamed');
  });
});

describe('human benchmark', () => {
  it('records a human answering the same question as the model', () => {
    const { db } = fresh();
    seedDatabase(db, { dataDirectory: 'data/oss' });
    const version = listVersions(db, listDatasets(db)[0]!.id)[0]!;
    const target = listCases(db, version.id)[0]!;

    const session = startHumanSession(db, {
      datasetVersionId: version.id,
      participantLabel: 'tester-1',
    });

    recordHumanResponse(db, {
      sessionId: session.id,
      participantLabel: 'tester-1',
      caseId: target.id,
      contextStrategy: 'TEST_PLUS_DIFF',
      verdict: 'FAIL',
      confidence: 0.7,
      timeSpentMs: 45_000,
      notes: 'unsure about the boundary',
    });

    const responses = listHumanResponses(db, session.id);
    expect(responses).toHaveLength(1);
    expect(responses[0]?.verdict).toBe('FAIL');
    expect(responses[0]?.timeSpentMs).toBe(45_000);

    finishHumanSession(db, session.id);
    expect(listHumanSessions(db)[0]?.finishedAt).not.toBeNull();
  });

  it('ignores a duplicate answer for the same case in one session', () => {
    const { db } = fresh();
    seedDatabase(db, { dataDirectory: 'data/oss' });
    const version = listVersions(db, listDatasets(db)[0]!.id)[0]!;
    const target = listCases(db, version.id)[0]!;
    const session = startHumanSession(db, {
      datasetVersionId: version.id,
      participantLabel: 'tester',
    });

    const answer = {
      sessionId: session.id,
      participantLabel: 'tester',
      caseId: target.id,
      contextStrategy: 'TEST_ONLY',
      verdict: 'PASS' as const,
      confidence: null,
      timeSpentMs: 1000,
    };

    recordHumanResponse(db, answer);
    recordHumanResponse(db, answer);

    expect(listHumanResponses(db, session.id)).toHaveLength(1);
  });
});

function basePrediction() {
  return {
    caseId: 'c1',
    repetition: 0,
    clusterId: 'owner/repo#1',
    goldVerdict: 'PASS' as const,
    predictedVerdict: 'PASS' as const,
    confidence: 0.8,
    errorKind: null,
    latency: {
      requestStartedAt: 0,
      firstTokenAt: null,
      finalTokenAt: 100,
      parsedAt: 100,
      ttftMs: null,
      generationMs: null,
      modelLatencyMs: 100,
      endToEndMs: 100,
    },
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      reasoningTokens: 0,
      totalTokens: 15,
    },
    costUsd: 0.001,
    flipPairId: null,
    revision: 'head' as const,
    slices: {},
  };
}
