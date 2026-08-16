import type {
  BenchmarkCase,
  EvaluatedPrediction,
  LatencyMeasurement,
  TokenUsage,
} from '@tob/core';

export const usage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 1000,
  outputTokens: 200,
  cachedTokens: 0,
  reasoningTokens: 0,
  totalTokens: 1200,
  ...overrides,
});

export const latency = (
  overrides: Partial<LatencyMeasurement> = {},
): LatencyMeasurement => ({
  requestStartedAt: 0,
  firstTokenAt: null,
  finalTokenAt: 100,
  parsedAt: 100,
  ttftMs: null,
  generationMs: null,
  modelLatencyMs: 100,
  endToEndMs: 100,
  ...overrides,
});

let sequence = 0;

export const prediction = (
  overrides: Partial<EvaluatedPrediction> = {},
): EvaluatedPrediction => {
  sequence += 1;
  return {
    caseId: `case_${sequence}`,
    repetition: 0,
    clusterId: 'owner/repo#1',
    goldVerdict: 'PASS',
    predictedVerdict: 'PASS',
    confidence: 0.8,
    errorKind: null,
    latency: latency(),
    usage: usage(),
    costUsd: 0.01,
    flipPairId: null,
    revision: 'head',
    slices: {},
    ...overrides,
  };
};

export const benchmarkCase = (overrides: Partial<BenchmarkCase> = {}): BenchmarkCase => ({
  id: 'case_1',
  revision: 'head',
  flipPairId: null,
  pr: {
    repository: 'owner/repo',
    number: 1,
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    title: 'Handle empty ranges',
    description: 'Closes an edge case in range handling.',
    diff: '--- a/src/range.ts\n+++ b/src/range.ts\n@@\n-  return end - start;\n+  return Math.max(0, end - start);',
    changedFiles: 1,
    addedLines: 1,
    deletedLines: 1,
    commits: 1,
    language: 'TypeScript',
    labels: ['bug'],
  },
  testCase: {
    id: 'tc_1',
    title: 'Empty range reports zero length',
    preconditions: 'A range helper is available.',
    steps: ['Create a range where the end is before the start.', 'Read the reported length.'],
    expectedResult: 'The reported length is zero.',
  },
  gold: { result: 'PASS' },
  metadata: {
    executedAt: '2026-01-01T00:00:00.000Z',
    testType: 'BUSINESS_LOGIC',
    tags: ['boundary'],
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
      evidenceTestFile: 'test/range.test.ts',
      note: 'Added regression test fails before the change.',
      source: 'REPRODUCED',
    },
  },
  ...overrides,
});

/**
 * The self-test fixture referenced throughout the scoring tests.
 *
 * 12 attempts: 4 gold-PASS predicted PASS, 2 gold-PASS predicted FAIL,
 * 3 gold-FAIL predicted FAIL, 2 gold-FAIL predicted PASS, and 1 gold-FAIL that
 * produced no verdict at all. Every expected number in the tests is derived by
 * hand from those counts.
 */
export const goldenPredictions = (): EvaluatedPrediction[] => [
  ...Array.from({ length: 4 }, () => prediction({ goldVerdict: 'PASS', predictedVerdict: 'PASS' })),
  ...Array.from({ length: 2 }, () => prediction({ goldVerdict: 'PASS', predictedVerdict: 'FAIL' })),
  ...Array.from({ length: 3 }, () => prediction({ goldVerdict: 'FAIL', predictedVerdict: 'FAIL' })),
  ...Array.from({ length: 2 }, () => prediction({ goldVerdict: 'FAIL', predictedVerdict: 'PASS' })),
  prediction({
    goldVerdict: 'FAIL',
    predictedVerdict: null,
    confidence: null,
    errorKind: 'OUTPUT_CONTRACT',
  }),
];
