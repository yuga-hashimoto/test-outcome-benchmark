import { stripTestFileHunks } from './diff-filter';
import type { ContextStrategy } from '../domain/context';
import type { ModelFacingCase } from '../domain/case';

/**
 * Builds the model-facing description of a case. The parameter type is
 * `ModelFacingCase`, so the gold verdict is not in scope here at all.
 */

const section = (heading: string, body: string): string => `## ${heading}\n${body.trim()}`;

const testSection = (input: ModelFacingCase): string => {
  const steps = input.testCase.steps
    .map((step, index) => `${index + 1}. ${step}`)
    .join('\n');
  return section(
    'Test case',
    [
      `Title: ${input.testCase.title}`,
      `Preconditions: ${input.testCase.preconditions}`,
      `Steps:\n${steps}`,
      `Expected result: ${input.testCase.expectedResult}`,
    ].join('\n\n'),
  );
};

/**
 * Which revision the tester ran against. Every strategy that shows a change
 * must say this: without it, the two sides of a flip pair are indistinguishable
 * and the question has no determinate answer.
 */
const revisionSection = (input: ModelFacingCase): string => {
  const sha = input.revision === 'base' ? input.pr.baseSha : input.pr.headSha;
  const explanation =
    input.revision === 'base'
      ? 'The test is executed against the code BEFORE this pull request is applied.'
      : 'The test is executed against the code AFTER this pull request is applied.';
  return section('Revision under test', `${input.revision} (${sha})\n${explanation}`);
};

const titleSection = (input: ModelFacingCase): string =>
  section('Pull request title', input.pr.title);

const descriptionSection = (input: ModelFacingCase): string =>
  section('Pull request description', input.pr.description.trim() || '(no description provided)');

const diffSection = (input: ModelFacingCase): string =>
  section('Diff', `\`\`\`diff\n${input.pr.diff.trim()}\n\`\`\``);

/**
 * Same as `diffSection`, but with files that look like test files removed —
 * see IMPLEMENTATION_ONLY_DIFF's description for why. Says explicitly that
 * files were removed, rather than silently shrinking the diff, so a harness
 * comparing this to the full-diff strategy is not confused by a mismatched
 * file count.
 */
const implementationOnlyDiffSection = (input: ModelFacingCase): string => {
  const { diff, removedFiles } = stripTestFileHunks(input.pr.diff);
  const note =
    removedFiles.length === 0
      ? '(no files in this diff looked like test files)'
      : `(${removedFiles.length} file(s) that looked like test files were removed from this diff)`;
  const body = diff.length === 0 ? '(no non-test files changed)' : diff;
  return section('Diff (implementation only)', `${note}\n\n\`\`\`diff\n${body}\n\`\`\``);
};

const prMetadataSection = (input: ModelFacingCase): string =>
  section(
    'Pull request metadata',
    [
      `Repository: ${input.pr.repository}`,
      `Number: ${input.pr.number}`,
      `Changed files: ${input.pr.changedFiles ?? 'unknown'}`,
      `Added lines: ${input.pr.addedLines ?? 'unknown'}`,
      `Deleted lines: ${input.pr.deletedLines ?? 'unknown'}`,
      `Commits: ${input.pr.commits ?? 'unknown'}`,
      `Language: ${input.pr.language ?? 'unknown'}`,
      `Labels: ${input.pr.labels.length > 0 ? input.pr.labels.join(', ') : 'none'}`,
    ].join('\n'),
  );

const repositoryContextSection = (input: ModelFacingCase): string =>
  section(
    'Repository context',
    [
      `Repository: ${input.pr.repository}`,
      `Base commit: ${input.pr.baseSha}`,
      `Head commit: ${input.pr.headSha}`,
      `Primary language: ${input.pr.language ?? 'unknown'}`,
    ].join('\n'),
  );

const repositoryAgentSection = (): string =>
  section(
    'Available investigation',
    'You may reason about the repository statically. You must not execute the test, run the application, or rely on any runtime observation.',
  );

type SectionBuilder = (input: ModelFacingCase) => string;

const STRATEGY_SECTIONS: Readonly<Record<ContextStrategy, readonly SectionBuilder[]>> = {
  TEST_ONLY: [testSection],
  PR_ONLY: [revisionSection, titleSection, descriptionSection, diffSection],
  TEST_PLUS_PR_TITLE: [testSection, revisionSection, titleSection],
  TEST_PLUS_DIFF: [testSection, revisionSection, diffSection],
  TEST_PLUS_TITLE_DESCRIPTION_DIFF: [
    testSection,
    revisionSection,
    titleSection,
    descriptionSection,
    diffSection,
  ],
  IMPLEMENTATION_ONLY_DIFF: [
    testSection,
    revisionSection,
    titleSection,
    descriptionSection,
    implementationOnlyDiffSection,
  ],
  PR_FULL: [
    testSection,
    revisionSection,
    titleSection,
    descriptionSection,
    prMetadataSection,
    diffSection,
  ],
  PR_WITH_CONTEXT: [
    testSection,
    revisionSection,
    repositoryContextSection,
    titleSection,
    descriptionSection,
    prMetadataSection,
    diffSection,
  ],
  REPOSITORY_AGENT: [
    testSection,
    revisionSection,
    repositoryContextSection,
    titleSection,
    descriptionSection,
    prMetadataSection,
    diffSection,
    repositoryAgentSection,
  ],
};

export const buildContext = (input: ModelFacingCase, strategy: ContextStrategy): string => {
  const builders = STRATEGY_SECTIONS[strategy];
  return builders.map((build) => build(input)).join('\n\n');
};
