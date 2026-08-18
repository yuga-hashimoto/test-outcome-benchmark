import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCaseProvenance, evidencePathsOf, summarizeProvenanceFindings } from '@tob/core';
import { fail } from '../context';
import { heading } from '../format';
import { loadCaseFiles } from '../seed';
import type { BenchmarkCase, ProvenanceFinding, UpstreamCaseFacts, UpstreamDiffFile } from '@tob/core';
import type { Command } from 'commander';

interface GitResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

const git = (args: readonly string[], timeoutMs: number): Promise<GitResult> =>
  new Promise((resolve) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });

const mirrorDirectory = (cacheDirectory: string, repository: string): string =>
  join(cacheDirectory, repository.replace('/', '__'));

/**
 * A shallow fetch of one object is enough for every check here: the trees are
 * complete at each fetched commit, so `git diff` between two independently
 * fetched commits works without any shared history.
 */
const fetchObject = async (
  directory: string,
  repository: string,
  spec: string,
  attempts: number,
  timeoutMs: number,
  depth = 1,
): Promise<boolean> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await git(
      ['-C', directory, 'fetch', '-q', `--depth=${depth}`, `https://github.com/${repository}`, spec],
      timeoutMs,
    );
    if (result.ok) return true;
    // GitHub throttles parallel fetches; a transient failure looks identical to
    // a missing object, so only a retried failure is reported as missing.
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
  return false;
};

const hasCommit = async (directory: string, sha: string): Promise<boolean> =>
  (await git(['-C', directory, 'cat-file', '-e', `${sha}^{commit}`], 30_000)).ok;

const parseNumstat = (stdout: string): UpstreamDiffFile[] => {
  const files: UpstreamDiffFile[] = [];
  for (const line of stdout.split('\n')) {
    const parts = line.split('\t');
    if (parts.length !== 3) continue;
    const [added, deleted, path] = parts;
    // Binary files report "-" instead of a count; they carry no comparable
    // line counts, so they are recorded as present with zero lines.
    files.push({
      path: path ?? '',
      added: Number.parseInt(added ?? '', 10) || 0,
      deleted: Number.parseInt(deleted ?? '', 10) || 0,
    });
  }
  return files;
};

const collectFacts = async (
  benchmarkCase: BenchmarkCase,
  cacheDirectory: string,
  attempts: number,
  timeoutMs: number,
): Promise<UpstreamCaseFacts> => {
  const { repository, number, baseSha, headSha } = benchmarkCase.pr;
  const directory = mirrorDirectory(cacheDirectory, repository);
  mkdirSync(directory, { recursive: true });
  await git(['-C', directory, 'init', '-q'], 30_000);

  const ensure = async (sha: string): Promise<boolean> =>
    (await hasCommit(directory, sha)) ||
    ((await fetchObject(directory, repository, sha, attempts, timeoutMs)) && hasCommit(directory, sha));

  const baseShaResolves = await ensure(baseSha);
  const headShaResolves = await ensure(headSha);

  const pullRef = `refs/ccr/pull/${number}`;
  let pullRequestHeadSha: string | null = null;
  const fetchedPullRef = await fetchObject(
    directory,
    repository,
    `refs/pull/${number}/head:${pullRef}`,
    attempts,
    timeoutMs,
  );
  if (fetchedPullRef) {
    const resolved = await git(['-C', directory, 'rev-parse', pullRef], 30_000);
    if (resolved.ok) pullRequestHeadSha = resolved.stdout.trim();
  }

  let diffFiles: readonly UpstreamDiffFile[] | null = null;
  if (baseShaResolves && headShaResolves) {
    const diff = await git(['-C', directory, 'diff', '--numstat', baseSha, headSha], 120_000);
    if (diff.ok) diffFiles = parseNumstat(diff.stdout);
  }

  // The head commit's own change needs its parent, which the shallow fetch of
  // the head alone does not carry; the pull request ref was fetched at depth 1
  // too, so this deepens by one where it can and reports null where it cannot.
  let headCommitFiles: readonly UpstreamDiffFile[] | null = null;
  if (headShaResolves) {
    await fetchObject(directory, repository, headSha, 1, timeoutMs, 2);
    const show = await git(
      ['-C', directory, 'show', '--numstat', '--format=', '--first-parent', headSha],
      120_000,
    );
    if (show.ok && show.stdout.trim().length > 0) headCommitFiles = parseNumstat(show.stdout);
  }

  const resolvedEvidencePaths: string[] = [];
  for (const path of evidencePathsOf(benchmarkCase)) {
    for (const sha of [headSha, baseSha]) {
      const blob = await git(['-C', directory, 'cat-file', '-e', `${sha}:${path}`], 30_000);
      if (blob.ok) {
        resolvedEvidencePaths.push(path);
        break;
      }
    }
  }

  return {
    baseShaResolves,
    headShaResolves,
    pullRequestHeadSha,
    diffFiles,
    headCommitFiles,
    resolvedEvidencePaths,
  };
};

/**
 * Cases from the same pull request share every upstream fact, so they are
 * checked once and the findings are reported for each member of the cluster.
 */
const clusterKey = (benchmarkCase: BenchmarkCase): string =>
  `${benchmarkCase.pr.repository}#${benchmarkCase.pr.number}`;

const runWithConcurrency = async <T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> => {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index] as T, index);
    }
  });
  await Promise.all(runners);
};

/**
 * Checks the dataset against the repositories it claims to come from.
 *
 * Gold labels in this dataset are reconstructed from public pull requests, so
 * the weakest link is not the scoring code but whether a case still describes
 * the change it says it describes. This command answers that mechanically:
 * the commits must exist, `refs/pull/<n>/head` must be the stored head commit,
 * the stored diff must be a faithful subset of the upstream diff, and cited
 * evidence files must be real paths. It needs network access and clones
 * shallowly into a cache directory, so it is not part of `pnpm test`.
 */
export const registerVerifyDatasetCommand = (program: Command): void => {
  program
    .command('verify-dataset')
    .description('Check every case against the upstream repository it was built from (needs network)')
    .option('--data <dir>', 'Directory of case JSON files', 'data/oss')
    .option('--cache <dir>', 'Where to keep the shallow mirrors', '.cache/provenance')
    .option('--only <ids>', 'Comma-separated case ids to check')
    .option('--concurrency <n>', 'Parallel repositories', '3')
    .option('--attempts <n>', 'Fetch attempts before an object is called missing', '3')
    .option('--timeout <seconds>', 'Per-fetch timeout', '240')
    .option('--json <path>', 'Also write the findings as JSON')
    .action(
      async (options: {
        data: string;
        cache: string;
        only?: string;
        concurrency: string;
        attempts: string;
        timeout: string;
        json?: string;
      }) => {
        const concurrency = Number.parseInt(options.concurrency, 10);
        const attempts = Number.parseInt(options.attempts, 10);
        const timeoutSeconds = Number.parseInt(options.timeout, 10);
        if (!Number.isFinite(concurrency) || concurrency < 1) fail('--concurrency must be at least 1');
        if (!Number.isFinite(attempts) || attempts < 1) fail('--attempts must be at least 1');
        if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1) fail('--timeout must be at least 1');

        const wanted =
          options.only === undefined
            ? null
            : new Set(options.only.split(',').map((id) => id.trim()).filter((id) => id.length > 0));

        const cases = loadCaseFiles(options.data).filter(
          (item) => wanted === null || wanted.has(item.id),
        );
        if (cases.length === 0) fail('No cases selected');

        mkdirSync(options.cache, { recursive: true });

        const clusters = new Map<string, BenchmarkCase[]>();
        for (const item of cases) {
          const key = clusterKey(item);
          clusters.set(key, [...(clusters.get(key) ?? []), item]);
        }

        process.stdout.write(
          `Checking ${cases.length} case(s) across ${clusters.size} pull request(s) against GitHub.\n`,
        );

        const findings: ProvenanceFinding[] = [];
        let completed = 0;

        await runWithConcurrency([...clusters.values()], concurrency, async (members) => {
          const representative = members[0] as BenchmarkCase;
          const facts = await collectFacts(
            representative,
            options.cache,
            attempts,
            timeoutSeconds * 1000,
          );
          for (const member of members) findings.push(...checkCaseProvenance(member, facts));
          completed += 1;
          process.stdout.write(`  [${completed}/${clusters.size}] ${clusterKey(representative)}\n`);
        });

        const report = summarizeProvenanceFindings(findings, cases.length);

        process.stdout.write(`\n${heading('Provenance check')}\n`);
        process.stdout.write(
          `cases ${report.casesChecked}  pull requests ${clusters.size}  errors ${report.errors}  warnings ${report.warnings}\n\n`,
        );

        const ordered = [...report.findings].sort((left, right) =>
          left.severity === right.severity
            ? left.caseId.localeCompare(right.caseId)
            : left.severity === 'error'
              ? -1
              : 1,
        );
        for (const finding of ordered) {
          process.stdout.write(
            `${finding.severity === 'error' ? 'ERROR  ' : 'warning'} ${finding.caseId} ${finding.code}: ${finding.message}\n`,
          );
        }
        if (ordered.length === 0) {
          process.stdout.write('Every case matches the upstream repository it cites.\n');
        }

        if (options.json !== undefined) {
          writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
          process.stdout.write(`\nWrote ${options.json}\n`);
        }

        if (!report.ok) process.exitCode = 1;
      },
    );
};
