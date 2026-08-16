const TEST_PATH_TOKENS = new Set(['test', 'tests', 'spec', 'specs', '__tests__', '__specs__']);

const tokensOf = (segment: string): string[] =>
  segment
    .toLowerCase()
    .split(/[._-]/)
    .filter((token) => token.length > 0);

/** Catches `HashingTest.java`, `NumberToWordsTests.cs`, `ContentTypeTest.kt`
 * and similar camelCase suffixes with no delimiter before "Test"/"Spec". */
const hasCamelCaseTestSuffix = (segment: string): boolean =>
  /[a-z0-9](Test|Tests|Spec|Specs)(\.[A-Za-z0-9]+)?$/.test(segment);

/**
 * Best-effort classification of a changed file as a test file, not a
 * guarantee — real repositories use enough different test-naming
 * conventions (directory, `_`/`.`-delimited suffix, bare camelCase suffix)
 * that a heuristic will always have edge cases. Tuned against the file paths
 * actually cited as evidence across this dataset (see `data/oss/*.json`).
 */
export const isLikelyTestFilePath = (path: string): boolean =>
  path
    .split('/')
    .some(
      (segment) =>
        tokensOf(segment).some((token) => TEST_PATH_TOKENS.has(token)) ||
        hasCamelCaseTestSuffix(segment),
    );

export interface FilteredDiff {
  readonly diff: string;
  /** Paths of files removed from the diff because they look like test files. */
  readonly removedFiles: readonly string[];
}

const FILE_HEADER = /^diff --git a\/(.*?) b\/(.*)$/;

/**
 * Splits a unified multi-file diff on `diff --git` boundaries and drops any
 * file whose path looks like a test file.
 *
 * Exists so a context strategy can ask a model to reason about what an
 * implementation change does without also handing it the literal assertions
 * a PR added — reading `expect(x).toBe(y)` in an added test file is a
 * shortcut to the answer, not evidence the model understood the change.
 */
export const stripTestFileHunks = (diff: string): FilteredDiff => {
  const trimmed = diff.trim();
  if (trimmed.length === 0) return { diff: '', removedFiles: [] };

  const lines = trimmed.split('\n');
  const chunks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (FILE_HEADER.test(line) && current.length > 0) {
      chunks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) chunks.push(current);

  const kept: string[] = [];
  const removedFiles: string[] = [];

  for (const chunk of chunks) {
    const header = chunk[0] ?? '';
    const match = FILE_HEADER.exec(header);
    const path = match?.[2] ?? match?.[1] ?? null;

    if (path !== null && isLikelyTestFilePath(path)) {
      removedFiles.push(path);
      continue;
    }
    kept.push(chunk.join('\n'));
  }

  return { diff: kept.join('\n'), removedFiles };
};
