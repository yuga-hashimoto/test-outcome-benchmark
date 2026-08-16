import Link from 'next/link';
import {
  LEADERBOARD_METRICS,
  METRIC_DESCRIPTORS,
  buildModelPromptMatrix,
  rankRuns,
} from '@tob/core';
import { listRunSummaries } from '@tob/db';
import { Heatmap } from '@/components/Heatmap';
import { Bar, Empty, Note } from '@/components/Stat';
import { db } from '@/lib/db';
import { millis, money, percent, score } from '@/lib/format';
import type { LeaderboardMetric, RunSummary } from '@tob/core';

export const dynamic = 'force-dynamic';

const formatValue = (metric: LeaderboardMetric, value: number): string => {
  const descriptor = METRIC_DESCRIPTORS[metric];
  if (descriptor.format === 'ratio') return percent(value);
  if (descriptor.format === 'currency') return money(value);
  if (descriptor.format === 'milliseconds') return millis(value);
  return score(value);
};

/**
 * A model ranking is only meaningful with the prompt and context held fixed,
 * and vice versa. Rather than silently mixing configurations, each ranking
 * states the slice it holds constant.
 */
const rankingSection = (
  title: string,
  explanation: string,
  summaries: readonly RunSummary[],
  metric: LeaderboardMetric,
  describe: (summary: RunSummary) => string,
) => (
  <>
    <h2>{title}</h2>
    <p className="lede">{explanation}</p>
    {summaries.length === 0 ? (
      <Empty>Not enough runs for this comparison.</Empty>
    ) : (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th className="wrap">Configuration</th>
              <th className="num">{METRIC_DESCRIPTORS[metric].label}</th>
              <th className="num">Accuracy</th>
              <th className="num">FAIL recall</th>
              <th className="num">Flip pairs</th>
              <th className="num">Consistency</th>
            </tr>
          </thead>
          <tbody>
            {rankRuns(summaries, metric).map((entry) => (
              <tr key={entry.summary.runId}>
                <td className="muted">{entry.rank}</td>
                <td className="wrap">
                  <Link href={`/runs/${entry.summary.runId}`}>{describe(entry.summary)}</Link>
                </td>
                <td className="num">
                  {formatValue(metric, entry.value)}{' '}
                  {METRIC_DESCRIPTORS[metric].format === 'ratio' && <Bar value={entry.value} />}
                </td>
                <td className="num">{percent(entry.summary.metrics.accuracy)}</td>
                <td className="num">{percent(entry.summary.metrics.classification.fail.recall)}</td>
                <td className="num">{percent(entry.summary.metrics.flipPairs.accuracy)}</td>
                <td className="num">{percent(entry.summary.metrics.stability.consistencyRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </>
);

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ metric?: string }>;
}) {
  const { metric: requested } = await searchParams;
  const metric: LeaderboardMetric = (LEADERBOARD_METRICS as readonly string[]).includes(
    requested ?? '',
  )
    ? (requested as LeaderboardMetric)
    : 'accuracy';

  const summaries = listRunSummaries(db());

  if (summaries.length === 0) {
    return (
      <>
        <h1>Leaderboards</h1>
        <Empty>No completed runs yet.</Empty>
      </>
    );
  }

  /** The most-used prompt and model define the slices held fixed. */
  const commonest = <T,>(values: readonly T[]): T | undefined => {
    const counts = new Map<T, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()].sort(([, a], [, b]) => b - a)[0]?.[0];
  };

  const anchorPrompt = commonest(summaries.map((summary) => summary.promptId));
  const anchorModel = commonest(summaries.map((summary) => summary.modelConfigId));
  const anchorStrategy = commonest(summaries.map((summary) => summary.contextStrategy));

  const modelRanking = summaries.filter(
    (summary) => summary.promptId === anchorPrompt && summary.contextStrategy === anchorStrategy,
  );
  const promptRanking = summaries.filter(
    (summary) => summary.modelConfigId === anchorModel && summary.contextStrategy === anchorStrategy,
  );

  const anchorPromptLabel = modelRanking[0];
  const anchorModelLabel = promptRanking[0];

  return (
    <>
      <h1>Leaderboards</h1>
      <p className="lede">Rank by any metric. Each ranking states what it holds fixed.</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
        {LEADERBOARD_METRICS.map((item) => (
          <Link
            key={item}
            href={`/leaderboard?metric=${item}`}
            className="pill"
            style={
              item === metric
                ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'transparent' }
                : undefined
            }
          >
            {METRIC_DESCRIPTORS[item].label}
          </Link>
        ))}
      </div>

      {rankingSection(
        'Configuration ranking',
        'Every completed run: model, prompt, inference settings and context strategy together.',
        summaries,
        metric,
        (summary) =>
          `${summary.modelName} · ${summary.promptName} v${summary.promptVersion} · ${summary.contextStrategy} · data v${summary.datasetVersion}`,
      )}

      {rankingSection(
        'Model ranking',
        anchorPromptLabel === undefined
          ? 'Prompt and context strategy held fixed.'
          : `Prompt fixed to ${anchorPromptLabel.promptName} v${anchorPromptLabel.promptVersion}, context strategy fixed to ${anchorPromptLabel.contextStrategy}.`,
        modelRanking,
        metric,
        (summary) => summary.modelName,
      )}

      {rankingSection(
        'Prompt ranking',
        anchorModelLabel === undefined
          ? 'Model and context strategy held fixed.'
          : `Model fixed to ${anchorModelLabel.modelName}, context strategy fixed to ${anchorModelLabel.contextStrategy}.`,
        promptRanking,
        metric,
        (summary) => `${summary.promptName} v${summary.promptVersion}`,
      )}

      <h2>Model × prompt</h2>
      <p className="lede">
        {METRIC_DESCRIPTORS[metric].label} for each pairing. Where a pairing was run more than
        once, the most recent run is shown.
      </p>
      <Heatmap matrix={buildModelPromptMatrix(summaries, metric)} />

      <Note>
        A ranking is a starting point, not a verdict. Check the confidence interval on a run before
        treating a gap of a point or two as real, and compare two runs directly on the Compare page
        to get a paired interval on the difference.
      </Note>
    </>
  );
}
