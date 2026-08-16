import { buildContext, createRng, toModelFacingCase } from '@tob/core';
import {
  finishHumanSession,
  findDatasetByName,
  latestVersion,
  listCases,
  listHumanResponses,
  listHumanSessions,
  recordHumanResponse,
  startHumanSession,
} from '@tob/db';
import { InputEnded, ask, createLineReader } from './prompt-io';
import { fail, withDatabase } from '../context';
import { heading, percent, table } from '../format';
import type { Command } from 'commander';
import type { BenchmarkCase, ContextStrategy, Verdict } from '@tob/core';

const shuffled = <T>(items: readonly T[], seed: string): T[] => {
  const rng = createRng(seed);
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = rng.int(index + 1);
    const current = result[index] as T;
    result[index] = result[swap] as T;
    result[swap] = current;
  }
  return result;
};

/**
 * Puts a human in front of exactly the input a model receives, so the model
 * numbers can eventually be read against a human number rather than against
 * intuition. Cases are shuffled per participant so the order of the dataset
 * does not become part of the measurement.
 */
export const registerHumanCommand = (program: Command, dbPath: () => string | undefined): void => {
  const human = program.command('human').description('Human benchmark');

  human
    .command('run')
    .description('Answer benchmark cases yourself, with the same input a model gets')
    .option('--dataset <name>', 'Dataset name', 'test-outcome-v1')
    .requiredOption('--participant <label>', 'Participant label')
    .option('--strategy <strategy>', 'Context strategy', 'TEST_PLUS_TITLE_DESCRIPTION_DIFF')
    .option('--split <split>', 'train | dev | test | hidden-test')
    .option('--limit <n>', 'Stop after this many cases', '10')
    .action(
      async (options: {
        dataset: string;
        participant: string;
        strategy: string;
        split?: string;
        limit: string;
      }) => {
        await withDatabase(dbPath(), async ({ db }) => {
          const dataset = findDatasetByName(db, options.dataset);
          if (dataset === null) fail(`Unknown dataset ${options.dataset}`);

          const version = latestVersion(db, dataset!.id);
          if (version === null) fail(`Dataset ${options.dataset} has no frozen versions`);

          const cases = shuffled(
            listCases(db, version!.id, (options.split ?? null) as never),
            `human:${options.participant}`,
          ).slice(0, Number(options.limit));

          if (cases.length === 0) fail('No cases to answer.');

          const session = startHumanSession(db, {
            datasetVersionId: version!.id,
            participantLabel: options.participant,
          });

          const reader = createLineReader(process.stdin);
          let answered = 0;
          let stoppedEarly = false;

          try {
            process.stdout.write(
              `\n${cases.length} cases. For each one, answer PASS or FAIL and how confident you are.\nYou are seeing exactly what the model sees. Ctrl-C stops; answers already given are saved.\n`,
            );

            for (const [index, benchmarkCase] of cases.entries()) {
              const rendered = buildContext(
                toModelFacingCase(benchmarkCase as BenchmarkCase),
                options.strategy as ContextStrategy,
              );

              process.stdout.write(heading(`Case ${index + 1} of ${cases.length}`));
              process.stdout.write(`\n${rendered}\n\n`);

              const startedAt = Date.now();
              let verdict: Verdict | null = null;
              while (verdict === null) {
                const answer = (
                  await ask(reader, process.stdout, 'Will this test PASS or FAIL? [p/f] ')
                ).toLowerCase();
                if (answer.startsWith('p')) verdict = 'PASS';
                else if (answer.startsWith('f')) verdict = 'FAIL';
                else process.stdout.write('Please answer p or f.\n');
              }

              const confidenceInput = await ask(
                reader,
                process.stdout,
                'Confidence 0-1 (blank to skip): ',
              );
              const parsed = Number(confidenceInput);
              const confidence =
                confidenceInput.length > 0 && Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
                  ? parsed
                  : null;

              const notes = await ask(reader, process.stdout, 'Notes (optional): ');

              recordHumanResponse(db, {
                sessionId: session.id,
                participantLabel: options.participant,
                caseId: benchmarkCase.id,
                contextStrategy: options.strategy,
                verdict,
                confidence,
                timeSpentMs: Date.now() - startedAt,
                notes,
              });
              answered += 1;
            }
          } catch (error) {
            /** Input ending part-way is a normal way to stop, not a failure —
             * everything answered so far is already saved. */
            if (!(error instanceof InputEnded)) throw error;
            stoppedEarly = true;
          } finally {
            reader.close();
            finishHumanSession(db, session.id);
          }

          if (stoppedEarly) {
            process.stdout.write(`\nInput ended after ${answered} of ${cases.length} cases.\n`);
          }
          process.stdout.write(`\nRecorded ${answered} answers for ${options.participant}.\n`);
          process.stdout.write(`Score them with: benchmark human score --session ${session.id}\n`);
        });
      },
    );

  human
    .command('score')
    .description('Score a human session against the gold verdicts')
    .option('--dataset <name>', 'Dataset name', 'test-outcome-v1')
    .option('--session <id>', 'Session id (defaults to the most recent)')
    .action(async (options: { dataset: string; session?: string }) => {
      await withDatabase(dbPath(), ({ db }) => {
        const sessions = listHumanSessions(db);
        const session =
          options.session === undefined
            ? sessions[sessions.length - 1]
            : sessions.find((item) => item.id.startsWith(options.session as string));

        if (session === undefined) fail('No human session found.');

        const dataset = findDatasetByName(db, options.dataset);
        if (dataset === null) fail(`Unknown dataset ${options.dataset}`);

        const gold = new Map(
          listCases(db, session!.datasetVersionId).map((item) => [item.id, item.gold.result]),
        );
        const responses = listHumanResponses(db, session!.id);

        if (responses.length === 0) fail('That session has no answers.');

        const correct = responses.filter(
          (response) => gold.get(response.caseId) === response.verdict,
        ).length;
        const totalMs = responses.reduce((sum, response) => sum + response.timeSpentMs, 0);

        process.stdout.write(heading(`Human: ${session!.participantLabel}`));
        process.stdout.write(
          `\n${table([
            ['Accuracy', percent(correct / responses.length), `${correct}/${responses.length}`],
            ['Median time per case', `${Math.round(totalMs / responses.length / 1000)}s`, ''],
            ['Total time', `${Math.round(totalMs / 60000)} min`, ''],
          ])}\n`,
        );
        process.stdout.write(
          '\nThis is a small sample answered by one person; read it as a reference point, not a human baseline.\n',
        );
      });
    });

  human
    .command('sessions')
    .description('List human benchmark sessions')
    .action(async () => {
      await withDatabase(dbPath(), ({ db }) => {
        const rows: string[][] = [['ID', 'PARTICIPANT', 'ANSWERS', 'STARTED']];
        for (const session of listHumanSessions(db)) {
          rows.push([
            session.id.slice(0, 12),
            session.participantLabel,
            String(listHumanResponses(db, session.id).length),
            session.startedAt.slice(0, 16).replace('T', ' '),
          ]);
        }
        process.stdout.write(rows.length === 1 ? 'No human sessions yet.\n' : `${table(rows)}\n`);
      });
    });
};
