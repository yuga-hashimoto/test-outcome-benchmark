import Link from 'next/link';
import {
  LEADERBOARD_METRICS,
  METRIC_DESCRIPTORS,
  buildModelPromptMatrix,
  rankRunsInScope,
} from '@tob/core';
import { Heatmap } from './Heatmap';
import { Bar, Empty, Note } from './Stat';
import { millis, money, percent, score } from '@/lib/format';
import type { LeaderboardMetric, RunSummary } from '@tob/core';

const formatValue = (metric: LeaderboardMetric, value: number): string => {
  const descriptor = METRIC_DESCRIPTORS[metric];
  if (descriptor.format === 'ratio') return percent(value);
  if (descriptor.format === 'currency') return money(value);
  if (descriptor.format === 'milliseconds') return millis(value);
  return score(value);
};

const commonest = <T,>(values: readonly T[]): T | undefined => {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(([, a], [, b]) => b - a)[0]?.[0];
};

function Ranking({
  title,
  explanation,
  summaries,
  metric,
  describe,
}: {
  title: string;
  explanation: string;
  summaries: readonly RunSummary[];
  metric: LeaderboardMetric;
  describe: (summary: RunSummary) => string;
}) {
  const { scope, ranked, excluded } = rankRunsInScope(summaries, metric);

  return (
    <>
      <h2>{title}</h2>
      <p className="lede">
        {explanation}
        {scope !== null &&
          ` Scored on dataset v${scope.datasetVersion}${scope.split === null ? '' : `/${scope.split}`}.`}
      </p>
      {ranked.length === 0 ? (
        <Empty>Not enough runs for this comparison.</Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th className="wrap">Configuration</th>
                <th className="num">n</th>
                <th className="num">{METRIC_DESCRIPTORS[metric].label}</th>
                <th className="num">Accuracy</th>
                <th className="num">FAIL recall</th>
                <th className="num">Flip pairs</th>
                <th className="num">Consistency</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((entry) => (
                <tr key={entry.summary.runId}>
                  <td className="muted">{entry.rank}</td>
                  <td className="wrap">
                    <Link href={`/runs/${entry.summary.runId}`}>{describe(entry.summary)}</Link>
                  </td>
                  <td className="num muted">{entry.summary.resolved}</td>
                  <td className="num">
                    {formatValue(metric, entry.value)}{' '}
                    {METRIC_DESCRIPTORS[metric].format === 'ratio' && <Bar value={entry.value} />}
                  </td>
                  <td className="num">{percent(entry.summary.metrics.accuracy)}</td>
                  <td className="num">
                    {percent(entry.summary.metrics.classification.fail.recall)}
                  </td>
                  <td className="num">{percent(entry.summary.metrics.flipPairs.accuracy)}</td>
                  <td className="num">
                    {percent(entry.summary.metrics.stability.consistencyRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {excluded.length > 0 && (
        <Note tone="warn">
          {excluded.length} run(s) scored on a different dataset version or split are not shown
          here — mixing them in would rank estimates from different samples against each other.
          Open the Compare page to read a difference between runs on different scopes.
        </Note>
      )}
    </>
  );
}

/**
 * A model ranking is only meaningful with the prompt and context held fixed,
 * and vice versa. Rather than silently mixing configurations, each ranking
 * states the slice it holds constant.
 */
export function LeaderboardView({
  summaries,
  metric,
}: {
  summaries: readonly RunSummary[];
  metric: LeaderboardMetric;
}) {
  if (summaries.length === 0) {
    return (
      <>
        <h1>Leaderboards</h1>
        <Empty>No completed formal benchmark runs yet.</Empty>
      </>
    );
  }

  const anchorPrompt = commonest(summaries.map((summary) => summary.promptId));
  const anchorModel = commonest(summaries.map((summary) => summary.modelConfigId));
  const anchorStrategy = commonest(summaries.map((summary) => summary.contextStrategy));

  const modelRanking = summaries.filter(
    (summary) => summary.promptId === anchorPrompt && summary.contextStrategy === anchorStrategy,
  );
  const promptRanking = summaries.filter(
    (summary) =>
      summary.modelConfigId === anchorModel && summary.contextStrategy === anchorStrategy,
  );

  const promptAnchor = modelRanking[0];
  const modelAnchor = promptRanking[0];

  return (
    <>
      <h1>Leaderboards</h1>
      <p className="lede">Rank by any metric. Each ranking states what it holds fixed.</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
        {LEADERBOARD_METRICS.map((item) => (
          <Link
            key={item}
            href={`/leaderboard/${item}`}
            className="pill"
            style={
              item === metric
                ? {
                    background: 'var(--accent-soft)',
                    color: 'var(--accent)',
                    borderColor: 'transparent',
                  }
                : undefined
            }
          >
            {METRIC_DESCRIPTORS[item].label}
          </Link>
        ))}
      </div>

      <Ranking
        title="Configuration ranking"
        explanation="Every completed run: model, prompt, inference settings and context strategy together."
        summaries={summaries}
        metric={metric}
        describe={(summary) =>
          `${summary.modelName} · ${summary.promptName} v${summary.promptVersion} · ${summary.contextStrategy} · data v${summary.datasetVersion}`
        }
      />

      <Ranking
        title="Model ranking"
        explanation={
          promptAnchor === undefined
            ? 'Prompt and context strategy held fixed.'
            : `Prompt fixed to ${promptAnchor.promptName} v${promptAnchor.promptVersion}, context strategy fixed to ${promptAnchor.contextStrategy}.`
        }
        summaries={modelRanking}
        metric={metric}
        describe={(summary) => summary.modelName}
      />

      <Ranking
        title="Prompt ranking"
        explanation={
          modelAnchor === undefined
            ? 'Model and context strategy held fixed.'
            : `Model fixed to ${modelAnchor.modelName}, context strategy fixed to ${modelAnchor.contextStrategy}.`
        }
        summaries={promptRanking}
        metric={metric}
        describe={(summary) => `${summary.promptName} v${summary.promptVersion}`}
      />

      <h2>Model × prompt</h2>
      <p className="lede">
        {METRIC_DESCRIPTORS[metric].label} for each pairing. Where a pairing was run more than once,
        the most recent run is shown — cells can come from different dataset versions or splits,
        unlike the rankings above which hold that fixed.
      </p>
      <Heatmap matrix={buildModelPromptMatrix(summaries, metric)} />

      <Note>
        A ranking is a starting point, not a verdict. Check the confidence interval on a run before
        treating a gap of a point or two as real, and open a pair on the Compare page to get an
        interval on the difference itself.
      </Note>
    </>
  );
}
