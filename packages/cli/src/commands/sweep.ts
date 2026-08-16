import { CONTEXT_STRATEGIES, rankRuns } from '@tob/core';
import {
  findDatasetByName,
  findModelConfigByName,
  findPromptByName,
  latestVersion,
  listRunSummaries,
} from '@tob/db';
import { runSweep } from '@tob/runner';
import { fail, withDatabase } from '../context';
import { heading, interval, percent, table } from '../format';
import type { Command } from 'commander';
import type { ContextStrategy, PredictionMode, Split } from '@tob/core';

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

/**
 * Runs a whole comparison matrix in one command. Answering "which model, which
 * prompt" needs every cell measured on the same dataset version, and doing that
 * by hand invites mismatched settings between runs.
 */
export const registerSweepCommand = (program: Command, dbPath: () => string | undefined): void => {
  program
    .command('sweep')
    .description('Run a Model × Prompt × Context matrix and rank the results')
    .option('--dataset <name>', 'Dataset name', 'test-outcome-v1')
    .requiredOption('--models <names>', 'Comma-separated model configuration names')
    .requiredOption('--prompts <names>', 'Comma-separated prompt names')
    .option('--strategies <list>', 'Comma-separated context strategies')
    .option('--mode <mode>', 'FORCED or SELECTIVE', 'FORCED')
    .option('--repetitions <n>', 'Repetitions per case', '3')
    .option('--concurrency <n>', 'Maximum in-flight requests per run', '4')
    .option('--split <split>', 'train | dev | test | hidden-test')
    .option('--distribution <distribution>', 'natural or balanced', 'natural')
    .option('--seed <n>', 'Seed for every stochastic component', '20260816')
    .action(
      async (options: {
        dataset: string;
        models: string;
        prompts: string;
        strategies?: string;
        mode: string;
        repetitions: string;
        concurrency: string;
        split?: string;
        distribution: string;
        seed: string;
      }) => {
        const strategies = (options.strategies === undefined
          ? ['TEST_PLUS_TITLE_DESCRIPTION_DIFF']
          : splitList(options.strategies)) as ContextStrategy[];

        for (const strategy of strategies) {
          if (!(CONTEXT_STRATEGIES as readonly string[]).includes(strategy)) {
            fail(`Unknown context strategy ${strategy}`);
          }
        }

        await withDatabase(dbPath(), async ({ db }) => {
          const dataset = findDatasetByName(db, options.dataset);
          if (dataset === null) fail(`Unknown dataset ${options.dataset}`);

          const version = latestVersion(db, dataset!.id);
          if (version === null) fail(`Dataset ${options.dataset} has no frozen versions`);

          const modelIds = splitList(options.models).map((name) => {
            const config = findModelConfigByName(db, name);
            if (config === null) fail(`Unknown model configuration ${name}`);
            return config!.id;
          });

          const promptIds = splitList(options.prompts).map((name) => {
            const prompt = findPromptByName(db, name);
            if (prompt === null) fail(`Unknown prompt ${name}`);
            return prompt!.id;
          });

          const total = modelIds.length * promptIds.length * strategies.length;
          process.stdout.write(`Running ${total} configurations.\n`);

          const result = await runSweep(db, {
            datasetVersionId: version!.id,
            modelConfigIds: modelIds,
            promptIds,
            contextStrategies: strategies,
            predictionMode: options.mode as PredictionMode,
            repetitions: Number(options.repetitions),
            concurrency: Number(options.concurrency),
            seed: Number(options.seed),
            distribution: options.distribution as 'natural' | 'balanced',
            ...(options.split !== undefined ? { split: options.split as Split } : {}),
            onCellStart: (cell) => {
              process.stdout.write(`\n[${cell.index}/${cell.total}] ${cell.contextStrategy}\n`);
            },
            onCellFinish: (cell) => {
              process.stdout.write(
                cell.error === null
                  ? `  accuracy (head) ${percent(cell.metrics?.headAccuracy ?? null)}\n`
                  : `  failed: ${cell.error}\n`,
              );
            },
          });

          const runIds = new Set(
            result.cells
              .map((cell) => cell.run?.id)
              .filter((id): id is string => id !== undefined),
          );
          const summaries = listRunSummaries(db, 500).filter((summary) =>
            runIds.has(summary.runId),
          );

          process.stdout.write(heading('Sweep results'));
          process.stdout.write(
            `\n${table([
              ['#', 'MODEL', 'PROMPT', 'STRATEGY', 'ACCURACY (HEAD)', '95% INTERVAL', 'FLIP PAIRS'],
              ...rankRuns(summaries, 'headAccuracy').map((entry) => [
                String(entry.rank),
                entry.summary.modelName,
                `${entry.summary.promptName} v${entry.summary.promptVersion}`,
                entry.summary.contextStrategy,
                percent(entry.value),
                interval(
                  entry.value,
                  entry.summary.metrics.headAccuracyInterval.lower,
                  entry.summary.metrics.headAccuracyInterval.upper,
                ),
                percent(entry.summary.metrics.flipPairs.accuracy),
              ]),
            ])}\n`,
          );

          if (result.failed > 0) {
            process.stdout.write(`\n${result.failed} configuration(s) failed:\n`);
            for (const cell of result.cells.filter((item) => item.error !== null)) {
              process.stdout.write(`  ${cell.contextStrategy}: ${cell.error}\n`);
            }
          }

          process.stdout.write(
            `\nCompleted ${result.completed}/${result.cells.length} in ${Math.round(result.wallClockMs / 1000)}s.\n`,
          );
        });
      },
    );
};
