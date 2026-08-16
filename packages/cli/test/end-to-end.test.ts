import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Exercises the CLI as a user does, by spawning the real binary.
 *
 * The unit tests cover the logic behind each command; these cover the wiring —
 * argument parsing, command registration, exit codes and the interaction with
 * a real database file. A silent no-op in a command body looks like success to
 * every other kind of test.
 */

const workspace = new URL('../../..', import.meta.url).pathname;
let directory: string;
let databasePath: string;

const run = (...args: string[]): string =>
  execFileSync('npx', ['tsx', 'packages/cli/src/bin.ts', '--db', databasePath, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  });

const runExpectingFailure = (...args: string[]): { status: number; stderr: string } => {
  try {
    run(...args);
    return { status: 0, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stderr?: Buffer | string };
    return {
      status: failure.status ?? -1,
      stderr: String(failure.stderr ?? ''),
    };
  }
};

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'tob-e2e-'));
  databasePath = join(directory, 'benchmark.sqlite');
  run('seed', '--with-mocks');
}, 300_000);

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('cli end to end', () => {
  it('seeds a dataset, prompts and models', () => {
    expect(run('dataset', 'list')).toContain('test-outcome-v1');
    expect(run('prompt', 'list')).toContain('reasoning-v1');
    expect(run('model', 'list')).toContain('mock-thorough');
  });

  it('runs a benchmark and reports accuracy first', () => {
    const output = run(
      'run',
      '--model',
      'mock-thorough',
      '--prompt',
      'reasoning-v1',
      '--split',
      'dev',
      '--repetitions',
      '1',
      '--quiet',
    );

    expect(output).toContain('Accuracy');
    expect(output).toContain('Strict accuracy');
    expect(output).toContain('Confusion matrix');
    expect(output).toMatch(/Accuracy\s+\d+\.\d%/);
  });

  it('lists the run and shows its scorecard', () => {
    const runs = run('runs');
    expect(runs).toContain('COMPLETED');

    const runId = /run_[0-9a-f-]{8}/.exec(runs)?.[0];
    expect(runId).toBeDefined();
    expect(run('show', runId as string)).toContain('Class performance');
  });

  it('keeps mock runs out of the formal leaderboard unless explicitly included', () => {
    const formal = runExpectingFailure('leaderboard');
    expect(formal.status).toBe(1);
    expect(formal.stderr).toContain('No completed formal runs yet');

    expect(run('leaderboard', '--include-mocks')).toContain('Accuracy');
    expect(run('leaderboard', '--include-mocks', '--metric', 'failRecall')).toContain('FAIL recall');
  });

  it('rejects an unknown metric with a non-zero exit', () => {
    const failure = runExpectingFailure('leaderboard', '--metric', 'not-a-metric');
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain('Unknown metric');
  });

  it('rejects an unknown context strategy with a non-zero exit', () => {
    const failure = runExpectingFailure(
      'run',
      '--model',
      'mock-thorough',
      '--prompt',
      'reasoning-v1',
      '--strategy',
      'NOPE',
    );
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain('Unknown context strategy');
  });

  it('runs a sweep across a matrix and ranks the cells', () => {
    const output = run(
      'sweep',
      '--models',
      'mock-thorough,mock-lean',
      '--prompts',
      'reasoning-v1',
      '--strategies',
      'TEST_ONLY,TEST_PLUS_DIFF',
      '--split',
      'dev',
      '--repetitions',
      '1',
    );

    expect(output).toContain('Running 4 configurations');
    expect(output).toContain('Sweep results');
    expect(output).toContain('Completed 4/4');
  });

  it('exports cases without any gold verdict and imports answers back', () => {
    const exportPath = join(directory, 'cases.jsonl');
    const answersPath = join(directory, 'answers.jsonl');

    const exported = run(
      'export-cases',
      '--prompt',
      'reasoning-v1',
      '--split',
      'dev',
      '--out',
      exportPath,
    );
    expect(exported).toContain('No gold verdicts are present in the export');

    const cases = require('node:fs')
      .readFileSync(exportPath, 'utf8')
      .split('\n')
      .filter((line: string) => line.trim().length > 0)
      .map((line: string) => JSON.parse(line) as { caseId: string });

    expect(cases.length).toBeGreaterThan(0);

    writeFileSync(
      answersPath,
      `${cases
        .map((item: { caseId: string }) =>
          JSON.stringify({
            caseId: item.caseId,
            verdict: 'PASS',
            confidence: 0.6,
            reason: 'answered by the test harness',
          }),
        )
        .join('\n')}\n`,
      'utf8',
    );

    const imported = run(
      'import-run',
      '--model',
      'test-harness',
      '--prompt',
      'reasoning-v1',
      '--split',
      'dev',
      '--file',
      answersPath,
    );

    expect(imported).toContain('Accuracy');
    expect(imported).toContain(`Imported ${cases.length} predictions`);
  });

  it('compares two runs and states whether the difference is distinguishable', () => {
    const ids = [...run('runs', '--limit', '10').matchAll(/run_[0-9a-f-]{8}/g)].map(
      (match) => match[0],
    );
    expect(ids.length).toBeGreaterThanOrEqual(2);

    const output = run('compare', ids[0] as string, ids[1] as string);
    expect(output).toContain('Paired comparison');
    expect(output).toMatch(/interval (excludes|includes) zero/);
  });

  it('records piped answers in the human benchmark', () => {
    const output = execFileSync(
      'npx',
      [
        'tsx',
        'packages/cli/src/bin.ts',
        '--db',
        databasePath,
        'human',
        'run',
        '--participant',
        'e2e',
        '--split',
        'dev',
        '--limit',
        '2',
      ],
      {
        cwd: workspace,
        encoding: 'utf8',
        input: 'p\n0.8\nfirst\nf\n0.5\nsecond\n',
        timeout: 180_000,
      },
    );

    expect(output).toContain('Recorded 2 answers');
    expect(run('human', 'score')).toContain('Accuracy');
  });
});
