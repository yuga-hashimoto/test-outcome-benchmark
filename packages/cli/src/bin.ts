#!/usr/bin/env -S npx tsx
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import {
  CONTEXT_STRATEGIES,
  LEADERBOARD_METRICS,
  METRIC_DESCRIPTORS,
  dashboardHighlights,
  rankRuns,
} from '@tob/core';
import {
  createModelConfig,
  createPrompt,
  findDatasetByName,
  findModelConfigByName,
  findPromptByName,
  freezeDatasetVersion,
  getRunMetrics,
  latestVersion,
  listDatasets,
  listModelConfigs,
  listPrompts,
  listRunSummaries,
  listRuns,
  listVersions,
} from '@tob/db';
import { compareRuns, recomputeRunMetrics, resumeRun, startRun } from '@tob/runner';
import { fail, withDatabase } from './context';
import { registerExternalCommands } from './commands/external';
import { registerHumanCommand } from './commands/human';
import { registerSweepCommand } from './commands/sweep';
import { heading, interval, percent, score, table } from './format';
import { loadCaseFiles, seedDatabase } from './seed';
import { renderRunReport } from './report';
import type { ContextStrategy, LeaderboardMetric, PredictionMode, Split } from '@tob/core';

const program = new Command();

program
  .name('benchmark')
  .description('Measure how accurately a model predicts real test outcomes from a pull request.')
  .option('--db <path>', 'SQLite database path (default: data/benchmark.sqlite)');

const dbPath = (): string | undefined => program.opts<{ db?: string }>().db;

const out = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

program
  .command('seed')
  .description('Load the bundled dataset, prompts and mock models')
  .option('--data <dir>', 'Directory of case JSON files', 'data/oss')
  .option('--force', 'Freeze a new dataset version even if one exists', false)
  .action(async (options: { data: string; force: boolean }) => {
    await withDatabase(dbPath(), ({ db }) => {
      const result = seedDatabase(db, { dataDirectory: options.data, force: options.force });

      out(heading('Seed complete'));
      out(
        table([
          ['Dataset', `${result.datasetName} v${result.datasetVersion}`],
          ['Cases', String(result.caseCount)],
          ['Repositories', String(result.repositories)],
          ['Prompts created', String(result.promptsCreated)],
          ['Models created', String(result.modelsCreated)],
        ]),
      );

      if (result.skipped) {
        out('\nDataset version already present; re-run with --force to freeze a new one.');
      }
      for (const warning of result.warnings) {
        out(`\nWarning [${warning.code}]: ${warning.message}`);
      }
      out('\nTry:  pnpm benchmark run --model mock-thorough --prompt reasoning-v1');
    });
  });

const datasetCommand = program.command('dataset').description('Manage datasets');

datasetCommand
  .command('list')
  .description('List datasets and their versions')
  .action(async () => {
    await withDatabase(dbPath(), ({ db }) => {
      const rows: string[][] = [['NAME', 'VERSIONS', 'LATEST', 'CASES']];
      for (const dataset of listDatasets(db)) {
        const versions = listVersions(db, dataset.id);
        const newest = versions[0];
        rows.push([
          dataset.name,
          String(versions.length),
          newest === undefined ? '—' : `v${newest.version}`,
          newest === undefined ? '—' : String(newest.caseCount),
        ]);
      }
      out(rows.length === 1 ? 'No datasets yet. Run: pnpm benchmark seed' : table(rows));
    });
  });

datasetCommand
  .command('import <directory>')
  .description('Freeze a new immutable dataset version from a directory of case JSON files')
  .requiredOption('--name <name>', 'Dataset name')
  .option('--notes <notes>', 'Version notes', '')
  .action(async (directory: string, options: { name: string; notes: string }) => {
    await withDatabase(dbPath(), ({ db }) => {
      const dataset = findDatasetByName(db, options.name);
      if (dataset === null) fail(`Unknown dataset ${options.name}`);

      const cases = loadCaseFiles(directory);
      const { version, warnings } = freezeDatasetVersion(db, {
        datasetId: dataset!.id,
        cases,
        notes: options.notes,
      });

      out(`Froze ${options.name} v${version.version} with ${version.caseCount} cases.`);
      for (const warning of warnings) out(`Warning [${warning.code}]: ${warning.message}`);
    });
  });

const promptCommand = program.command('prompt').description('Manage prompts');

promptCommand
  .command('list')
  .description('List the newest version of every prompt')
  .action(async () => {
    await withDatabase(dbPath(), ({ db }) => {
      const rows: string[][] = [['NAME', 'VERSION', 'HASH', 'DESCRIPTION']];
      for (const prompt of listPrompts(db)) {
        rows.push([
          prompt.name,
          `v${prompt.version}`,
          prompt.contentHash.slice(0, 12),
          prompt.description,
        ]);
      }
      out(table(rows));
    });
  });

promptCommand
  .command('show <name>')
  .description('Print a prompt in full')
  .action(async (name: string) => {
    await withDatabase(dbPath(), ({ db }) => {
      const prompt = findPromptByName(db, name);
      if (prompt === null) fail(`Unknown prompt ${name}`);
      out(heading(`${prompt!.name} v${prompt!.version}  ${prompt!.contentHash.slice(0, 12)}`));
      out(prompt!.content);
    });
  });

promptCommand
  .command('create')
  .description('Create a prompt from a text file')
  .requiredOption('--name <name>', 'Prompt name')
  .requiredOption('--file <path>', 'File containing the prompt text')
  .option('--description <text>', 'Description', '')
  .action(async (options: { name: string; file: string; description: string }) => {
    await withDatabase(dbPath(), ({ db }) => {
      const prompt = createPrompt(db, {
        name: options.name,
        description: options.description,
        content: readFileSync(options.file, 'utf8'),
      });
      out(`Created ${prompt.name} v${prompt.version} (${prompt.contentHash.slice(0, 12)}).`);
    });
  });

const modelCommand = program.command('model').description('Manage model configurations');

modelCommand
  .command('list')
  .description('List model configurations')
  .action(async () => {
    await withDatabase(dbPath(), ({ db }) => {
      const rows: string[][] = [['NAME', 'PROVIDER', 'MODEL', 'KEY VAR', 'PRICED']];
      for (const config of listModelConfigs(db)) {
        rows.push([
          config.name,
          config.provider,
          config.model,
          config.apiKeyEnvVar ?? '—',
          config.pricing === null ? 'no' : 'yes',
        ]);
      }
      out(table(rows));
    });
  });

modelCommand
  .command('add')
  .description('Add a model configuration')
  .requiredOption('--name <name>', 'Configuration name')
  .requiredOption('--provider <provider>', 'mock | openai | anthropic | gemini | openai-compatible')
  .requiredOption('--model <model>', 'Provider model identifier')
  .option('--api-key-env <var>', 'Name of the environment variable holding the API key')
  .option('--base-url <url>', 'Base URL for the provider')
  .option('--temperature <value>', 'Sampling temperature')
  .option('--max-output-tokens <value>', 'Maximum output tokens')
  .option('--stream', 'Stream the response so time-to-first-token can be measured', false)
  .option('--input-price <usd>', 'Input price per million tokens')
  .option('--output-price <usd>', 'Output price per million tokens')
  .action(
    async (options: {
      name: string;
      provider: string;
      model: string;
      apiKeyEnv?: string;
      baseUrl?: string;
      temperature?: string;
      maxOutputTokens?: string;
      stream: boolean;
      inputPrice?: string;
      outputPrice?: string;
    }) => {
      await withDatabase(dbPath(), ({ db }) => {
        const priced = options.inputPrice !== undefined && options.outputPrice !== undefined;

        const config = createModelConfig(db, {
          name: options.name,
          provider: options.provider as never,
          model: options.model,
          apiKeyEnvVar: options.apiKeyEnv ?? null,
          baseUrl: options.baseUrl ?? null,
          settings: {
            stream: options.stream,
            ...(options.temperature !== undefined
              ? { temperature: Number(options.temperature) }
              : {}),
            ...(options.maxOutputTokens !== undefined
              ? { maxOutputTokens: Number(options.maxOutputTokens) }
              : {}),
          },
          pricing: priced
            ? {
                currency: 'USD',
                inputPerMillion: Number(options.inputPrice),
                outputPerMillion: Number(options.outputPrice),
                cachedInputPerMillion: null,
                reasoningPerMillion: null,
                source: 'provided on the command line',
                snapshotAt: new Date().toISOString(),
              }
            : null,
        });

        out(`Added ${config.name} (${config.provider}/${config.model}).`);
        if (!priced) {
          out('No pricing given, so cost metrics will be unavailable for this configuration.');
        }
      });
    },
  );

program
  .command('run')
  .description('Run a benchmark')
  .option('--dataset <name>', 'Dataset name', 'test-outcome-v1')
  .requiredOption('--model <name>', 'Model configuration name')
  .requiredOption('--prompt <name>', 'Prompt name')
  .option('--strategy <strategy>', 'Context strategy', 'TEST_PLUS_TITLE_DESCRIPTION_DIFF')
  .option('--mode <mode>', 'FORCED or SELECTIVE', 'FORCED')
  .option('--repetitions <n>', 'Repetitions per case', '3')
  .option('--concurrency <n>', 'Maximum in-flight requests', '4')
  .option('--split <split>', 'train | dev | test | hidden-test')
  .option('--distribution <distribution>', 'natural or balanced', 'natural')
  .option('--seed <n>', 'Seed for every stochastic component', '20260816')
  .option('--quiet', 'Suppress per-case progress', false)
  .action(
    async (options: {
      dataset: string;
      model: string;
      prompt: string;
      strategy: string;
      mode: string;
      repetitions: string;
      concurrency: string;
      split?: string;
      distribution: string;
      seed: string;
      quiet: boolean;
    }) => {
      if (!(CONTEXT_STRATEGIES as readonly string[]).includes(options.strategy)) {
        fail(`Unknown context strategy ${options.strategy}. Options: ${CONTEXT_STRATEGIES.join(', ')}`);
      }

      await withDatabase(dbPath(), async ({ db }) => {
        const dataset = findDatasetByName(db, options.dataset);
        if (dataset === null) fail(`Unknown dataset ${options.dataset}. Run: pnpm benchmark seed`);

        const version = latestVersion(db, dataset!.id);
        if (version === null) fail(`Dataset ${options.dataset} has no frozen versions`);

        const model = findModelConfigByName(db, options.model);
        if (model === null) fail(`Unknown model configuration ${options.model}`);

        const prompt = findPromptByName(db, options.prompt);
        if (prompt === null) fail(`Unknown prompt ${options.prompt}`);

        const controller = new AbortController();
        const onSignal = (): void => {
          out('\nCancelling. Completed predictions are already saved.');
          controller.abort();
        };
        process.once('SIGINT', onSignal);

        const result = await startRun(db, {
          datasetVersionId: version!.id,
          modelConfigId: model!.id,
          promptId: prompt!.id,
          contextStrategy: options.strategy as ContextStrategy,
          predictionMode: options.mode as PredictionMode,
          repetitions: Number(options.repetitions),
          concurrency: Number(options.concurrency),
          seed: Number(options.seed),
          distribution: options.distribution as 'natural' | 'balanced',
          ...(options.split !== undefined ? { split: options.split as Split } : {}),
          signal: controller.signal,
          ...(options.quiet
            ? {}
            : {
                onProgress: (progress) => {
                  process.stdout.write(
                    `\r  ${progress.completed}/${progress.total}  ${progress.caseId} → ${progress.verdict ?? progress.errorKind ?? 'none'}          `,
                  );
                },
              }),
        });

        process.off('SIGINT', onSignal);
        if (!options.quiet) process.stdout.write('\n');

        if (result.metrics === null) {
          fail(`Run ${result.run.id} ended with status ${result.status}.`);
        }

        out(renderRunReport(result.metrics!, `${result.run.name}  [${result.run.id}]`));
        if (result.skipped > 0) out(`\nResumed: ${result.skipped} attempts were already on disk.`);
      });
    },
  );

program
  .command('resume <runId>')
  .description('Resume an interrupted run using its stored configuration')
  .action(async (runId: string) => {
    await withDatabase(dbPath(), async ({ db }) => {
      const result = await resumeRun(db, { runId });
      if (result.metrics === null) fail(`Run ended with status ${result.status}.`);
      out(renderRunReport(result.metrics!, `${result.run.name}  [${result.run.id}]`));
    });
  });

program
  .command('runs')
  .description('List runs')
  .option('--limit <n>', 'Maximum rows', '25')
  .action(async (options: { limit: string }) => {
    await withDatabase(dbPath(), ({ db }) => {
      const rows: string[][] = [['ID', 'STATUS', 'PROGRESS', 'ACCURACY', 'NAME']];
      for (const run of listRuns(db, Number(options.limit))) {
        const metrics = getRunMetrics(db, run.id);
        rows.push([
          run.id.slice(0, 12),
          run.status,
          `${run.completedPredictions}/${run.totalPredictions}`,
          percent(metrics?.accuracy ?? null),
          run.name,
        ]);
      }
      out(rows.length === 1 ? 'No runs yet.' : table(rows));
    });
  });

program
  .command('show <runId>')
  .description('Print the full scorecard for a run')
  .action(async (runId: string) => {
    await withDatabase(dbPath(), ({ db }) => {
      const run = listRuns(db, 1000).find((item) => item.id.startsWith(runId));
      if (run === undefined) fail(`Unknown run ${runId}`);

      const metrics = getRunMetrics(db, run!.id) ?? recomputeRunMetrics(db, run!.id);
      out(renderRunReport(metrics, `${run!.name}  [${run!.id}]`));
    });
  });

program
  .command('compare <baselineRunId> <candidateRunId>')
  .description('Paired comparison of two runs over the same cases')
  .action(async (baselineRunId: string, candidateRunId: string) => {
    await withDatabase(dbPath(), ({ db }) => {
      const runs = listRuns(db, 1000);
      const baseline = runs.find((item) => item.id.startsWith(baselineRunId));
      const candidate = runs.find((item) => item.id.startsWith(candidateRunId));
      if (baseline === undefined) fail(`Unknown run ${baselineRunId}`);
      if (candidate === undefined) fail(`Unknown run ${candidateRunId}`);

      const comparison = compareRuns(db, baseline!.id, candidate!.id);

      out(heading('Paired comparison'));
      out(
        table([
          ['Baseline', baseline!.name, percent(comparison.baselineAccuracy)],
          ['Candidate', candidate!.name, percent(comparison.candidateAccuracy)],
          [
            'Delta',
            '',
            interval(
              comparison.deltaAccuracy,
              comparison.interval.lower,
              comparison.interval.upper,
            ),
          ],
          ['Matched cases', String(comparison.matchedCases), ''],
        ]),
      );

      if (!comparison.sameDatasetVersion) {
        out('\nThese runs used different dataset versions; the delta compares only the cases they share.');
      }
      if (comparison.interval.lower !== null && comparison.interval.upper !== null) {
        const significant =
          (comparison.interval.lower > 0 && comparison.interval.upper > 0) ||
          (comparison.interval.lower < 0 && comparison.interval.upper < 0);
        out(
          significant
            ? '\nThe interval excludes zero.'
            : '\nThe interval includes zero, so this difference is not distinguishable from noise.',
        );
      }
    });
  });

program
  .command('leaderboard')
  .description('Rank completed runs')
  .option('--metric <metric>', `One of: ${LEADERBOARD_METRICS.join(', ')}`, 'accuracy')
  .action(async (options: { metric: string }) => {
    if (!(LEADERBOARD_METRICS as readonly string[]).includes(options.metric)) {
      fail(`Unknown metric ${options.metric}`);
    }

    await withDatabase(dbPath(), ({ db }) => {
      const summaries = listRunSummaries(db);
      if (summaries.length === 0) fail('No completed runs yet.');

      const metric = options.metric as LeaderboardMetric;
      const descriptor = METRIC_DESCRIPTORS[metric];

      const ranked = rankRuns(summaries, metric);
      const versions = new Set(ranked.map((entry) => entry.summary.datasetVersion));
      const showsAccuracySeparately = metric !== 'accuracy';

      out(heading(`${descriptor.label} (${descriptor.direction} is better)`));
      out(
        table([
          [
            '#',
            'MODEL',
            'PROMPT',
            'STRATEGY',
            'DATA',
            descriptor.label.toUpperCase(),
            ...(showsAccuracySeparately ? ['ACCURACY'] : []),
          ],
          ...ranked.map((entry) => [
            String(entry.rank),
            entry.summary.modelName,
            `${entry.summary.promptName} v${entry.summary.promptVersion}`,
            entry.summary.contextStrategy,
            `v${entry.summary.datasetVersion}`,
            descriptor.format === 'ratio' ? percent(entry.value) : score(entry.value),
            ...(showsAccuracySeparately ? [percent(entry.summary.metrics.accuracy)] : []),
          ]),
        ]),
      );

      if (versions.size > 1) {
        out(
          `\nThese runs span ${versions.size} dataset versions, so the ranking compares scores from different case sets.`,
        );
      }

      out(heading('Highlights'));
      out(
        table(
          dashboardHighlights(summaries).map((highlight) => [
            highlight.label,
            highlight.summary?.modelName ?? '—',
            highlight.summary === null
              ? ''
              : `${highlight.summary.promptName} v${highlight.summary.promptVersion}`,
          ]),
        ),
      );
    });
  });

registerSweepCommand(program, dbPath);
registerExternalCommands(program, dbPath);
registerHumanCommand(program, dbPath);

program.parseAsync(process.argv).catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
