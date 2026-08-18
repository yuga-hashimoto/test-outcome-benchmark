import { describe, expect, it } from 'vitest';
import {
  checkCaseProvenance,
  evidencePathsOf,
  summarizeProvenanceFindings,
  summarizeStoredDiff,
} from '@tob/core';
import { benchmarkCase } from './helpers';
import type { BenchmarkCase, UpstreamCaseFacts } from '@tob/core';

const TWO_FILE_DIFF = [
  'diff --git a/src/constant.js b/src/constant.js',
  'index 22d6e8adc..52547342e 100644',
  '--- a/src/constant.js',
  '+++ b/src/constant.js',
  '@@ -27,4 +27,4 @@',
  '-export const REGEX_FORMAT = /Y{1,4}/g',
  '+export const REGEX_FORMAT = /YYYY|YY/g',
  'diff --git a/test/display.test.js b/test/display.test.js',
  '--- a/test/display.test.js',
  '+++ b/test/display.test.js',
  '@@ -1,3 +1,5 @@',
  "+  expect(dayjs().format('Y')).toBe('Y')",
  "+  expect(dayjs().format('YYY')).toBe('24Y')",
].join('\n');

const withDiff = (diff: string, overrides: Partial<BenchmarkCase> = {}): BenchmarkCase => {
  const base = benchmarkCase(overrides);
  return { ...base, pr: { ...base.pr, diff } };
};

const facts = (overrides: Partial<UpstreamCaseFacts> = {}): UpstreamCaseFacts => ({
  baseShaResolves: true,
  headShaResolves: true,
  pullRequestHeadSha: 'b'.repeat(40),
  diffFiles: [
    { path: 'src/constant.js', added: 1, deleted: 1 },
    { path: 'test/display.test.js', added: 2, deleted: 0 },
  ],
  headCommitFiles: [
    { path: 'src/constant.js', added: 1, deleted: 1 },
    { path: 'test/display.test.js', added: 2, deleted: 0 },
  ],
  resolvedEvidencePaths: ['test/range.test.ts'],
  ...overrides,
});

const codes = (findings: readonly { code: string }[]): string[] => findings.map((f) => f.code);

describe('summarizeStoredDiff', () => {
  it('counts added and deleted lines per file, ignoring the +++/--- headers', () => {
    expect(summarizeStoredDiff(TWO_FILE_DIFF)).toEqual([
      { path: 'src/constant.js', added: 1, deleted: 1 },
      { path: 'test/display.test.js', added: 2, deleted: 0 },
    ]);
  });

  it('returns nothing for a diff with no file headers', () => {
    expect(summarizeStoredDiff('')).toEqual([]);
    expect(summarizeStoredDiff('+ a line with no header')).toEqual([]);
  });
});

describe('evidencePathsOf', () => {
  it('splits a comma-separated list and drops blanks', () => {
    const item = benchmarkCase();
    const withTwo: BenchmarkCase = {
      ...item,
      metadata: {
        ...item.metadata,
        provenance: { ...item.metadata.provenance, evidenceTestFile: 'a/one_test.go, b/two_test.go' },
      },
    };
    expect(evidencePathsOf(withTwo)).toEqual(['a/one_test.go', 'b/two_test.go']);
  });

  it('returns nothing when no evidence file is cited', () => {
    const item = benchmarkCase();
    const none: BenchmarkCase = {
      ...item,
      metadata: {
        ...item.metadata,
        provenance: { ...item.metadata.provenance, evidenceTestFile: null },
      },
    };
    expect(evidencePathsOf(none)).toEqual([]);
  });
});

describe('checkCaseProvenance', () => {
  it('reports nothing when the case matches the upstream repository exactly', () => {
    expect(checkCaseProvenance(withDiff(TWO_FILE_DIFF), facts())).toEqual([]);
  });

  it('errors when a commit the case pins no longer resolves', () => {
    const findings = checkCaseProvenance(
      withDiff(TWO_FILE_DIFF),
      facts({ baseShaResolves: false, headShaResolves: false }),
    );
    expect(codes(findings)).toEqual(['BASE_SHA_UNRESOLVED', 'HEAD_SHA_UNRESOLVED']);
    expect(findings.every((finding) => finding.severity === 'error')).toBe(true);
  });

  it('errors when the pull request head is not the commit the case stores', () => {
    const findings = checkCaseProvenance(
      withDiff(TWO_FILE_DIFF),
      facts({ pullRequestHeadSha: 'c'.repeat(40) }),
    );
    expect(codes(findings)).toEqual(['PR_HEAD_MISMATCH']);
  });

  it('warns rather than errors when the pull request ref cannot be read', () => {
    const findings = checkCaseProvenance(
      withDiff(TWO_FILE_DIFF),
      facts({ pullRequestHeadSha: null }),
    );
    expect(findings).toEqual([
      expect.objectContaining({ code: 'PR_REF_UNREADABLE', severity: 'warning' }),
    ]);
  });

  it('errors when the stored diff touches a file the upstream diff does not', () => {
    const findings = checkCaseProvenance(
      withDiff(TWO_FILE_DIFF),
      facts({ diffFiles: [{ path: 'src/constant.js', added: 1, deleted: 1 }] }),
    );
    expect(codes(findings)).toEqual(['DIFF_FILE_NOT_UPSTREAM']);
  });

  it('errors when the stored diff carries more lines than the pull request changed', () => {
    const findings = checkCaseProvenance(
      withDiff(TWO_FILE_DIFF),
      facts({
        diffFiles: [
          { path: 'src/constant.js', added: 1, deleted: 1 },
          { path: 'test/display.test.js', added: 1, deleted: 0 },
        ],
      }),
    );
    expect(codes(findings)).toEqual(['DIFF_LINES_EXCEED_UPSTREAM']);
  });

  it('warns when the stored diff matches neither the base..head diff nor the head commit', () => {
    const findings = checkCaseProvenance(
      withDiff(TWO_FILE_DIFF),
      facts({
        diffFiles: [
          { path: 'src/constant.js', added: 4, deleted: 3 },
          { path: 'test/display.test.js', added: 2, deleted: 0 },
        ],
        headCommitFiles: [
          { path: 'src/constant.js', added: 4, deleted: 3 },
          { path: 'test/display.test.js', added: 2, deleted: 0 },
        ],
      }),
    );
    expect(findings).toEqual([
      expect.objectContaining({ code: 'DIFF_ABRIDGED', severity: 'warning' }),
    ]);
  });

  it('accepts a stored diff that reproduces the head commit even when base..head is wider', () => {
    // The pull request's own commit changes 1 line of src/constant.js; the two
    // pinned revisions differ by more because base is the branch point.
    const findings = checkCaseProvenance(
      withDiff(TWO_FILE_DIFF),
      facts({
        diffFiles: [
          { path: 'src/constant.js', added: 4, deleted: 3 },
          { path: 'test/display.test.js', added: 2, deleted: 0 },
        ],
      }),
    );
    expect(findings).toEqual([]);
  });

  it('warns when the two pinned revisions differ beyond the pull request itself', () => {
    const findings = checkCaseProvenance(
      withDiff(TWO_FILE_DIFF),
      facts({
        diffFiles: [
          { path: 'src/constant.js', added: 1, deleted: 1 },
          { path: 'test/display.test.js', added: 2, deleted: 0 },
          { path: 'docs/unrelated.md', added: 30, deleted: 2 },
        ],
      }),
    );
    expect(findings).toEqual([
      expect.objectContaining({ code: 'REVISIONS_DIFFER_BEYOND_PR', severity: 'warning' }),
    ]);
  });

  it('errors when a cited evidence file is not a path at either revision', () => {
    const findings = checkCaseProvenance(
      withDiff(TWO_FILE_DIFF),
      facts({ resolvedEvidencePaths: [] }),
    );
    expect(codes(findings)).toEqual(['EVIDENCE_PATH_UNRESOLVED']);
    expect(findings[0]?.message).toContain('test/range.test.ts');
  });
});

describe('summarizeProvenanceFindings', () => {
  it('counts severities and fails the report only on errors', () => {
    const clean = summarizeProvenanceFindings([], 148);
    expect(clean).toMatchObject({ casesChecked: 148, errors: 0, warnings: 0, ok: true });

    const mixed = summarizeProvenanceFindings(
      [
        { caseId: 'a', severity: 'warning', code: 'DIFF_ABRIDGED', message: '' },
        { caseId: 'b', severity: 'error', code: 'PR_HEAD_MISMATCH', message: '' },
      ],
      2,
    );
    expect(mixed).toMatchObject({ errors: 1, warnings: 1, ok: false });
  });
});
