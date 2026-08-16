/**
 * Context strategy is an explicit experiment dimension (spec §11): how much of
 * the case the model is allowed to see. Ablating across these separates "the
 * model understands the test" from "the model pattern-matches the diff".
 */
export const CONTEXT_STRATEGIES = [
  'TEST_ONLY',
  'PR_ONLY',
  'TEST_PLUS_PR_TITLE',
  'TEST_PLUS_DIFF',
  'TEST_PLUS_TITLE_DESCRIPTION_DIFF',
  'IMPLEMENTATION_ONLY_DIFF',
  'PR_FULL',
  'PR_WITH_CONTEXT',
  'REPOSITORY_AGENT',
] as const;
export type ContextStrategy = (typeof CONTEXT_STRATEGIES)[number];

export interface ContextStrategyDescriptor {
  readonly id: ContextStrategy;
  readonly label: string;
  readonly description: string;
  readonly includesTest: boolean;
  readonly includesDiff: boolean;
  /**
   * Whether the strategy may perform static repository reads. Nothing in the
   * benchmark may execute the test, the application, or a runtime probe — the
   * prediction path is execution-free by construction (spec §11).
   */
  readonly allowsRepositoryReads: boolean;
}

export const CONTEXT_STRATEGY_DESCRIPTORS: Readonly<
  Record<ContextStrategy, ContextStrategyDescriptor>
> = {
  TEST_ONLY: {
    id: 'TEST_ONLY',
    label: 'Test only',
    description: 'The natural-language test case alone. Measures the prior with no change context.',
    includesTest: true,
    includesDiff: false,
    allowsRepositoryReads: false,
  },
  PR_ONLY: {
    id: 'PR_ONLY',
    label: 'PR only',
    description: 'PR title, description and diff with no test case. Measures how much the change alone gives away.',
    includesTest: false,
    includesDiff: true,
    allowsRepositoryReads: false,
  },
  TEST_PLUS_PR_TITLE: {
    id: 'TEST_PLUS_PR_TITLE',
    label: 'Test + PR title',
    description: 'The test case plus a one-line summary of the change.',
    includesTest: true,
    includesDiff: false,
    allowsRepositoryReads: false,
  },
  TEST_PLUS_DIFF: {
    id: 'TEST_PLUS_DIFF',
    label: 'Test + diff',
    description: 'The test case plus the raw diff, without the author’s narration.',
    includesTest: true,
    includesDiff: true,
    allowsRepositoryReads: false,
  },
  TEST_PLUS_TITLE_DESCRIPTION_DIFF: {
    id: 'TEST_PLUS_TITLE_DESCRIPTION_DIFF',
    label: 'Test + title + description + diff',
    description: 'The test case plus the full authored PR context.',
    includesTest: true,
    includesDiff: true,
    allowsRepositoryReads: false,
  },
  IMPLEMENTATION_ONLY_DIFF: {
    id: 'IMPLEMENTATION_ONLY_DIFF',
    label: 'Test + title + description + implementation-only diff',
    description:
      'Same as test + title + description + diff, but with files that look like test files stripped from the diff. A PR diff often includes the very test assertion a case describes, which turns "predict the outcome" into "read the assertion" — this strategy measures the former by removing the latter.',
    includesTest: true,
    includesDiff: true,
    allowsRepositoryReads: false,
  },
  PR_FULL: {
    id: 'PR_FULL',
    label: 'Full PR context',
    description: 'Everything on the PR including metadata and labels, plus the test case.',
    includesTest: true,
    includesDiff: true,
    allowsRepositoryReads: false,
  },
  PR_WITH_CONTEXT: {
    id: 'PR_WITH_CONTEXT',
    label: 'PR with repository context',
    description: 'Full PR context plus the revision under test and repository metadata.',
    includesTest: true,
    includesDiff: true,
    allowsRepositoryReads: false,
  },
  REPOSITORY_AGENT: {
    id: 'REPOSITORY_AGENT',
    label: 'Repository agent',
    description:
      'Full context plus static repository reads/search. Reserved for adapters that support tool use; still execution-free.',
    includesTest: true,
    includesDiff: true,
    allowsRepositoryReads: true,
  },
};
