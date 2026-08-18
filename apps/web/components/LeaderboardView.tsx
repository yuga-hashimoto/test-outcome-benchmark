import Link from 'next/link';
import {
  LEADERBOARD_METRICS,
  METRIC_DESCRIPTORS,
  buildModelPromptMatrix,
  rankRunsInScope,
} from '@tob/core';
import { Heatmap } from './Heatmap';
import { Bar, Empty, Note } from './Stat';
import { StrategyTabs } from './StrategyTabs';
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
          ` Scored on dataset v${scope.datasetVersion}${scope.split === null ? '' : `/${scope.split}`} · ${scope.contextStrategy}.`}
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
          {excluded.length} run(s) scored on a different dataset version, split, or context
          strategy are not shown here — mixing them in would rank estimates from different samples
          or different questions against each other. Open the Compare page to read a difference
          between runs on different scopes.
        </Note>
      )}
    </>
  );
}

/**
 * The rankings for one context strategy — everything below the strategy
 * tabs. Computed entirely on the server (it needs @tob/core, which pulls in
 * node:crypto and cannot be bundled for the browser); StrategyTabs only
 * switches which already-rendered panel is visible.
 */
function StrategyPanel({
  summaries,
  metric,
}: {
  summaries: readonly RunSummary[];
  metric: LeaderboardMetric;
}) {
  const anchorPrompt = commonest(summaries.map((summary) => summary.promptId));
  const anchorModel = commonest(summaries.map((summary) => summary.modelConfigId));

  const modelRanking = summaries.filter((summary) => summary.promptId === anchorPrompt);
  const promptRanking = summaries.filter((summary) => summary.modelConfigId === anchorModel);

  const promptAnchor = modelRanking[0];
  const modelAnchor = promptRanking[0];
  const strategy = summaries[0]?.contextStrategy ?? '';

  return (
    <>
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
        {METRIC_DESCRIPTORS[metric].label} for each pairing on the {strategy} track. Where a
        pairing was run more than once, the most recent run is shown.
      </p>
      <Heatmap matrix={buildModelPromptMatrix(summaries, metric)} />
    </>
  );
}

/**
 * A model ranking is only meaningful with the prompt and context held fixed,
 * and vice versa. Rather than silently mixing configurations, each ranking
 * states the slice it holds constant. A run scored on a different context
 * strategy (e.g. implementation-only-diff vs. the full diff) answered a
 * different question, so it gets its own tab rather than a mixed table.
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

  const strategies = [...new Set(summaries.map((summary) => summary.contextStrategy))].sort();
  /** summaries is non-empty here, so commonest always finds a value. */
  const dominantStrategy = commonest(summaries.map((summary) => summary.contextStrategy))!;

  const panels = Object.fromEntries(
    strategies.map((strategy) => [
      strategy,
      <StrategyPanel
        key={strategy}
        summaries={summaries.filter((summary) => summary.contextStrategy === strategy)}
        metric={metric}
      />,
    ]),
  );

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

      {strategies.length > 1 ? (
        <StrategyTabs strategies={strategies} defaultStrategy={dominantStrategy} panels={panels} />
      ) : (
        panels[dominantStrategy]
      )}

      <Note>
        A ranking is a starting point, not a verdict. Check the confidence interval on a run before
        treating a gap of a point or two as real, and open a pair on the Compare page to get an
        interval on the difference itself.
      </Note>
    </>
  );
}
