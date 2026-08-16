import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONTEXT_STRATEGIES } from '@tob/core';
import {
  createModelConfig,
  findDatasetByName,
  findModelConfigByName,
  findPromptByName,
  latestVersion,
} from '@tob/db';
import { exportCases, importRun } from '@tob/runner';
import { fail, withDatabase } from '../context';
import { renderRunReport } from '../report';
import type { Command } from 'commander';
import type { ContextStrategy, PredictionMode, Split } from '@tob/core';
import type { ExternalPrediction } from '@tob/runner';

const readJsonl = (path: string): ExternalPrediction[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as ExternalPrediction;
      } catch (error) {
        return fail(
          `Line ${index + 1} of ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        ) as never;
      }
    });

/**
 * Bridges a model the built-in adapters cannot reach.
 *
 * `export-cases` writes exactly what an adapter would send — gold already
 * stripped — and `import-run` records the answers as a first-class run. The two
 * commands share the rendering path with a normal run, so an imported result is
 * comparable to a native one rather than a differently-worded question.
 */
export const registerExternalCommands = (
  program: Command,
  dbPath: () => string | undefined,
): void => {
  program
    .command('export-cases')
    .description('Write the model-facing prompts to JSONL so an external harness can answer them')
    .option('--dataset <name>', 'Dataset name', 'test-outcome-v1')
    .requiredOption('--prompt <name>', 'Prompt name')
    .requiredOption('--out <path>', 'Output JSONL path')
    .option('--strategy <strategy>', 'Context strategy', 'TEST_PLUS_TITLE_DESCRIPTION_DIFF')
    .option('--mode <mode>', 'FORCED or SELECTIVE', 'FORCED')
    .option('--repetitions <n>', 'Repetitions per case', '1')
    .option('--split <split>', 'train | dev | test | hidden-test')
    .action(
      async (options: {
        dataset: string;
        prompt: string;
        out: string;
        strategy: string;
        mode: string;
        repetitions: string;
        split?: string;
      }) => {
        if (!(CONTEXT_STRATEGIES as readonly string[]).includes(options.strategy)) {
          fail(`Unknown context strategy ${options.strategy}`);
        }

        await withDatabase(dbPath(), ({ db }) => {
          const dataset = findDatasetByName(db, options.dataset);
          if (dataset === null) fail(`Unknown dataset ${options.dataset}`);

          const version = latestVersion(db, dataset!.id);
          if (version === null) fail(`Dataset ${options.dataset} has no frozen versions`);

          const prompt = findPromptByName(db, options.prompt);
          if (prompt === null) fail(`Unknown prompt ${options.prompt}`);

          const exported = exportCases(db, {
            datasetVersionId: version!.id,
            promptId: prompt!.id,
            contextStrategy: options.strategy as ContextStrategy,
            predictionMode: options.mode as PredictionMode,
            repetitions: Number(options.repetitions),
            ...(options.split !== undefined ? { split: options.split as Split } : {}),
          });

          mkdirSync(dirname(options.out), { recursive: true });
          writeFileSync(
            options.out,
            `${exported.map((item) => JSON.stringify(item)).join('\n')}\n`,
            'utf8',
          );

          const serialised = JSON.stringify(exported);
          /** Cheap assurance for the operator that the export is safe to hand out. */
          if (serialised.includes('"gold"')) {
            fail('Refusing to write an export containing gold verdicts.');
          }

          process.stdout.write(
            `Wrote ${exported.length} cases to ${options.out} (dataset v${version!.version}, prompt ${prompt!.name} v${prompt!.version}).\nNo gold verdicts are present in the export.\n`,
          );
        });
      },
    );

  program
    .command('import-run')
    .description('Record predictions produced by an external harness as a run')
    .option('--dataset <name>', 'Dataset name', 'test-outcome-v1')
    .requiredOption('--model <name>', 'Model configuration name (created if absent)')
    .requiredOption('--prompt <name>', 'Prompt name')
    .requiredOption('--file <path>', 'JSONL of predictions')
    .option('--strategy <strategy>', 'Context strategy', 'TEST_PLUS_TITLE_DESCRIPTION_DIFF')
    .option('--mode <mode>', 'FORCED or SELECTIVE', 'FORCED')
    .option('--split <split>', 'train | dev | test | hidden-test')
    .option('--name <name>', 'Run name')
    .action(
      async (options: {
        dataset: string;
        model: string;
        prompt: string;
        file: string;
        strategy: string;
        mode: string;
        split?: string;
        name?: string;
      }) => {
        await withDatabase(dbPath(), ({ db }) => {
          const dataset = findDatasetByName(db, options.dataset);
          if (dataset === null) fail(`Unknown dataset ${options.dataset}`);

          const version = latestVersion(db, dataset!.id);
          if (version === null) fail(`Dataset ${options.dataset} has no frozen versions`);

          const prompt = findPromptByName(db, options.prompt);
          if (prompt === null) fail(`Unknown prompt ${options.prompt}`);

          const model =
            findModelConfigByName(db, options.model) ??
            createModelConfig(db, {
              name: options.model,
              provider: 'external',
              model: options.model,
              settings: {},
            });

          const predictions = readJsonl(options.file);
          const result = importRun(db, {
            datasetVersionId: version!.id,
            modelConfigId: model.id,
            promptId: prompt!.id,
            predictions,
            contextStrategy: options.strategy as ContextStrategy,
            predictionMode: options.mode as PredictionMode,
            ...(options.split !== undefined ? { split: options.split as Split } : {}),
            ...(options.name !== undefined ? { name: options.name } : {}),
          });

          process.stdout.write(renderRunReport(result.metrics, `${result.run.name}  [${result.run.id}]`));
          process.stdout.write(`\n\nImported ${result.imported} predictions.\n`);

          if (result.unmatched.length > 0) {
            process.stdout.write(
              `${result.unmatched.length} answer(s) referenced case ids not in this dataset version and were ignored: ${[...new Set(result.unmatched)].slice(0, 5).join(', ')}\n`,
            );
          }
          if (result.missing > 0) {
            process.stdout.write(
              `${result.missing} case(s) were never answered. They are absent from this run, so its accuracy describes only the cases the harness attempted.\n`,
            );
          }
        });
      },
    );
};
