import { createHash } from 'node:crypto';

export const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * Identity of a prompt's text. Two prompts with the same hash are the same
 * prompt regardless of name or version number, which is what makes cross-run
 * prompt comparison trustworthy.
 */
export const hashPromptContent = (content: string): string => sha256(content);

/** Stable identity of a set of cases, used to freeze a dataset version. */
export const hashCaseIds = (caseIds: readonly string[]): string =>
  sha256([...caseIds].sort().join('\n'));
