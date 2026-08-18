import type { BenchmarkCase } from '../domain/case';

/**
 * One file as the upstream repository actually records it between two commits,
 * i.e. a row of `git diff --numstat <baseSha> <headSha>`.
 */
export interface UpstreamDiffFile {
  readonly path: string;
  readonly added: number;
  readonly deleted: number;
}

/** What the checker was able to observe upstream for one case. */
export interface UpstreamCaseFacts {
  /** Whether `pr.baseSha` resolves to a commit in the upstream repository. */
  readonly baseShaResolves: boolean;
  /** Whether `pr.headSha` resolves to a commit in the upstream repository. */
  readonly headShaResolves: boolean;
  /**
   * The commit `refs/pull/<number>/head` points at, or `null` when the ref
   * could not be read. This is what ties a case to the pull request it claims
   * to come from: a matching SHA cannot be produced by guessing.
   */
  readonly pullRequestHeadSha: string | null;
  /** `git diff --numstat baseSha headSha`, or `null` when it could not be run. */
  readonly diffFiles: readonly UpstreamDiffFile[] | null;
  /**
   * `git show --numstat headSha` — what the head commit alone changes.
   *
   * A pull request's base commit is often the branch point rather than the
   * parent of its head, so `baseSha..headSha` can also carry commits that
   * landed on the default branch in between. Without this second view, a
   * stored diff that reproduces the pull request's own commit exactly would be
   * misreported as abridged.
   */
  readonly headCommitFiles: readonly UpstreamDiffFile[] | null;
  /**
   * Paths from `metadata.provenance.evidenceTestFile` that resolve to a blob at
   * either revision. Paths absent from this list are reported as unresolvable.
   */
  readonly resolvedEvidencePaths: readonly string[];
}

export type ProvenanceSeverity = 'error' | 'warning';

export interface ProvenanceFinding {
  readonly caseId: string;
  readonly severity: ProvenanceSeverity;
  readonly code: string;
  readonly message: string;
}

const FILE_HEADER = /^diff --git a\/(.*?) b\/(.*)$/;

interface StoredDiffFile {
  readonly path: string;
  readonly added: number;
  readonly deleted: number;
}

/**
 * Counts the `+`/`-` lines the stored diff carries per file, so the stored text
 * can be compared against the upstream numstat rather than merely eyeballed.
 * File headers (`+++`/`---`) are not content lines and are excluded.
 */
export const summarizeStoredDiff = (diff: string): readonly StoredDiffFile[] => {
  const files: StoredDiffFile[] = [];
  let path: string | null = null;
  let added = 0;
  let deleted = 0;

  const flush = (): void => {
    if (path !== null) files.push({ path, added, deleted });
    path = null;
    added = 0;
    deleted = 0;
  };

  for (const line of diff.split('\n')) {
    const header = FILE_HEADER.exec(line);
    if (header !== null) {
      flush();
      path = header[2] ?? header[1] ?? null;
      continue;
    }
    if (path === null) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) deleted += 1;
  }
  flush();

  return files;
};

/**
 * Compares one case against what the upstream repository actually contains.
 *
 * The point of the severities: an `error` means the case does not describe the
 * change it claims to describe, so its gold label cannot be trusted. A
 * `warning` means the case is a faithful but partial view — an abridged diff is
 * a legitimate curation choice, yet a reader deserves to know the model saw
 * fewer lines than the pull request changed.
 *
 * This function is deliberately free of I/O: the caller supplies the upstream
 * facts, so the comparison itself stays deterministic and unit-testable.
 */
export const checkCaseProvenance = (
  benchmarkCase: BenchmarkCase,
  facts: UpstreamCaseFacts,
): readonly ProvenanceFinding[] => {
  const findings: ProvenanceFinding[] = [];
  const caseId = benchmarkCase.id;
  const add = (severity: ProvenanceSeverity, code: string, message: string): void => {
    findings.push({ caseId, severity, code, message });
  };

  if (!facts.baseShaResolves) {
    add('error', 'BASE_SHA_UNRESOLVED', `baseSha ${benchmarkCase.pr.baseSha} does not resolve upstream`);
  }
  if (!facts.headShaResolves) {
    add('error', 'HEAD_SHA_UNRESOLVED', `headSha ${benchmarkCase.pr.headSha} does not resolve upstream`);
  }

  if (facts.pullRequestHeadSha === null) {
    add(
      'warning',
      'PR_REF_UNREADABLE',
      `refs/pull/${benchmarkCase.pr.number}/head could not be read, so the case could not be tied to its pull request`,
    );
  } else if (facts.pullRequestHeadSha !== benchmarkCase.pr.headSha) {
    add(
      'error',
      'PR_HEAD_MISMATCH',
      `refs/pull/${benchmarkCase.pr.number}/head is ${facts.pullRequestHeadSha}, but the case stores ${benchmarkCase.pr.headSha}`,
    );
  }

  if (facts.diffFiles === null) {
    add('warning', 'DIFF_UNREADABLE', 'the base..head diff could not be computed upstream');
  } else {
    const upstream = new Map(facts.diffFiles.map((file) => [file.path, file]));
    const headCommit = new Map((facts.headCommitFiles ?? []).map((file) => [file.path, file]));
    const storedFiles = summarizeStoredDiff(benchmarkCase.pr.diff);

    for (const stored of storedFiles) {
      const real = upstream.get(stored.path);
      if (real === undefined) {
        add(
          'error',
          'DIFF_FILE_NOT_UPSTREAM',
          `the stored diff changes ${stored.path}, which the upstream base..head diff does not touch`,
        );
        continue;
      }
      if (stored.added > real.added || stored.deleted > real.deleted) {
        add(
          'error',
          'DIFF_LINES_EXCEED_UPSTREAM',
          `the stored diff for ${stored.path} has +${stored.added}/-${stored.deleted}, more than the upstream +${real.added}/-${real.deleted}`,
        );
        continue;
      }
      if (stored.added === real.added && stored.deleted === real.deleted) continue;

      // Reproducing the pull request's own commit exactly is faithful even when
      // base..head is wider, so only a diff matching neither view is abridged.
      const fromCommit = headCommit.get(stored.path);
      if (fromCommit?.added === stored.added && fromCommit?.deleted === stored.deleted) continue;

      add(
        'warning',
        'DIFF_ABRIDGED',
        `the stored diff for ${stored.path} has +${stored.added}/-${stored.deleted} of the upstream +${real.added}/-${real.deleted}`,
      );
    }

    if (facts.headCommitFiles !== null) {
      const storedPaths = new Set(storedFiles.map((file) => file.path));
      const unseen = facts.diffFiles.filter(
        (file) => !storedPaths.has(file.path) && !headCommit.has(file.path),
      );
      if (unseen.length > 0) {
        add(
          'warning',
          'REVISIONS_DIFFER_BEYOND_PR',
          `base..head also differs in ${unseen.length} file(s) the head commit does not touch, so baseSha is not the parent of headSha`,
        );
      }
    }
  }

  for (const path of evidencePathsOf(benchmarkCase)) {
    if (facts.resolvedEvidencePaths.includes(path)) continue;
    add(
      'error',
      'EVIDENCE_PATH_UNRESOLVED',
      `provenance.evidenceTestFile names ${path}, which is not a file at either revision`,
    );
  }

  return findings;
};

/**
 * `evidenceTestFile` holds one path, or several separated by commas. Anything
 * that is not a path is caught by the resolution check rather than here, so a
 * prose note smuggled into the field surfaces as an unresolved path.
 */
export const evidencePathsOf = (benchmarkCase: BenchmarkCase): readonly string[] => {
  const raw = benchmarkCase.metadata.provenance.evidenceTestFile;
  if (raw === null || raw.trim().length === 0) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

export interface ProvenanceReport {
  readonly findings: readonly ProvenanceFinding[];
  readonly casesChecked: number;
  readonly errors: number;
  readonly warnings: number;
  readonly ok: boolean;
}

export const summarizeProvenanceFindings = (
  findings: readonly ProvenanceFinding[],
  casesChecked: number,
): ProvenanceReport => {
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warnings = findings.length - errors;
  return { findings, casesChecked, errors, warnings, ok: errors === 0 };
};
