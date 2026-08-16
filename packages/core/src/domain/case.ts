import type { Verdict } from './verdict';

export const REVISIONS = ['base', 'head'] as const;
export type Revision = (typeof REVISIONS)[number];

export const TEST_TYPES = ['UI', 'API', 'BUSINESS_LOGIC', 'INTEGRATION', 'E2E', 'OTHER'] as const;
export type TestType = (typeof TEST_TYPES)[number];

export const QUALITATIVE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type QualitativeLevel = (typeof QUALITATIVE_LEVELS)[number];

/**
 * How the case was constructed.
 *
 * The patterns exist to break the correlation between `revision` and the gold
 * label. BUG_FIX and FEATURE alone produce a dataset answerable by "FAIL at
 * base, PASS at head"; UNRELATED and REFACTOR add PASS at base; KNOWN_BROKEN
 * (an open bug the change does not touch) and REGRESSION (a fault the change
 * introduced, fixed later) add FAIL at head. All six are needed for the
 * revision field to carry no usable signal on its own.
 */
export const CASE_PATTERNS = [
  'BUG_FIX',
  'FEATURE',
  'UNRELATED',
  'REFACTOR',
  'KNOWN_BROKEN',
  'REGRESSION',
] as const;
export type CasePattern = (typeof CASE_PATTERNS)[number];

export interface PullRequestContext {
  readonly repository: string;
  readonly number: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly title: string;
  readonly description: string;
  readonly diff: string;
  readonly changedFiles: number | null;
  readonly addedLines: number | null;
  readonly deletedLines: number | null;
  readonly commits: number | null;
  readonly language: string | null;
  readonly labels: readonly string[];
}

export interface TestCaseSpec {
  readonly id: string;
  readonly title: string;
  readonly preconditions: string;
  readonly steps: readonly string[];
  readonly expectedResult: string;
}

export interface CaseGold {
  readonly result: Verdict;
}

/** Where the gold label came from, so any label can be re-checked by hand. */
export interface CaseProvenance {
  readonly prUrl: string;
  readonly issueUrl: string | null;
  readonly evidenceTestFile: string | null;
  readonly note: string;
}

export interface CaseMetadata {
  readonly executedAt: string;
  readonly testType: TestType;
  readonly tags: readonly string[];
  readonly durationMs: number | null;
  readonly feature: string | null;
  readonly platform: string | null;
  readonly specificity: QualitativeLevel;
  readonly ambiguity: QualitativeLevel;
  readonly externalDependency: boolean;
  readonly casePattern: CasePattern;
  readonly provenance: CaseProvenance;
}

export interface BenchmarkCase {
  readonly id: string;
  readonly revision: Revision;
  readonly flipPairId: string | null;
  readonly pr: PullRequestContext;
  readonly testCase: TestCaseSpec;
  readonly gold: CaseGold;
  readonly metadata: CaseMetadata;
}

/**
 * The only shape a prompt is ever rendered from. `gold` is structurally absent,
 * so leaking it into model input is not expressible at this boundary.
 */
export type ModelFacingCase = Omit<BenchmarkCase, 'gold'>;

/**
 * Strips `gold` at runtime as well as in the type system. The redundancy is
 * deliberate: a case reconstructed from JSON or a database row can carry an
 * extra `gold` key that the compiler never saw.
 */
export const toModelFacingCase = (benchmarkCase: BenchmarkCase): ModelFacingCase => {
  const { gold: _gold, ...rest } = benchmarkCase;
  return rest;
};

/**
 * Identity of the pull request a case belongs to. Multiple cases share a
 * cluster, which is why interval estimates cluster on it rather than treating
 * cases as independent draws (spec §13).
 */
export const clusterIdOf = (benchmarkCase: Pick<BenchmarkCase, 'pr'>): string =>
  `${benchmarkCase.pr.repository}#${benchmarkCase.pr.number}`;

export const diffLinesOf = (pr: PullRequestContext): number =>
  (pr.addedLines ?? 0) + (pr.deletedLines ?? 0);

export const testTextLengthOf = (testCase: TestCaseSpec): number =>
  testCase.title.length +
  testCase.preconditions.length +
  testCase.steps.reduce((total, step) => total + step.length, 0) +
  testCase.expectedResult.length;
