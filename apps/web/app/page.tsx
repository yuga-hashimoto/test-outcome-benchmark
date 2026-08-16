import Link from 'next/link';
import { dashboardHighlights, formalBenchmarkRuns, paretoFront, rankRunsInScope } from '@tob/core';
import { listRunSummaries } from '@tob/db';
import { ScatterChart } from '@/components/ScatterChart';
import { Bar, Empty, Note, Stat } from '@/components/Stat';
import { db } from '@/lib/db';
import { count, intervalText, money, percent, shortId } from '@/lib/format';
import type { LeaderboardMetric, RunSummary } from '@tob/core';

export const dynamic = 'force-static';

const paretoPoints = (
  summaries: readonly RunSummary[],
  xMetric: LeaderboardMetric,
  yMetric: LeaderboardMetric,
) =>
  paretoFront(summaries, xMetric, yMetric).map((point) => ({
    id: point.summary.runId,
    label: `${point.summary.modelName} · ${point.summary.promptName} v${point.summary.promptVersion} · ${point.summary.contextStrategy}`,
    x: point.x,
    y: point.y,
    onFront: point.onFront,
  }));

export default function DashboardPage() {
  const allSummaries = listRunSummaries(db());
  const summaries = formalBenchmarkRuns(allSummaries);

  if (summaries.length === 0) {
    return (
      <>
        <h1>Dashboard</h1>
        <p className="lede">
          How accurately does a model predict the real PASS/FAIL outcome of a natural-language test
          case, given the pull request it runs against?
        </p>
        <Empty>
          No completed formal benchmark runs yet. Register a real model configuration and run it
          against the dataset. Development-only mock runs remain visible on the Runs page but do
          not participate in this dashboard or the formal leaderboard.
        </Empty>
      </>
    );
  }

  const { scope, ranked: accuracyRanked, excluded } = rankRunsInScope(summaries, 'headAccuracy');
  const best = accuracyRanked[0];
  const highlights = dashboardHighlights(summaries);

  return (
    <>
      <h1>Dashboard</h1>
      <p className="lede">
        How accurately does a model predict the real PASS/FAIL outcome of a natural-language test
        case, given the pull request it runs against?
      </p>

      <div className="grid" style={{ marginTop: 20 }}>
        <Stat
          label="Best accuracy (head)"
          value={percent(best?.value ?? null)}
          note={
            best === undefined
              ? undefined
              : (intervalText(
                  best.summary.metrics.headAccuracyInterval.lower,
                  best.summary.metrics.headAccuracyInterval.upper,
                ) ?? best.summary.modelName)
          }
        />
        <Stat
          label="Best FAIL recall"
          value={percent(
            highlights.find((item) => item.id === 'best-fail-recall')?.value ?? null,
          )}
          note="Share of real failures caught"
        />
        <Stat
          label="Best flip pair accuracy"
          value={percent(rankRunsInScope(summaries, 'flipPairAccuracy').ranked[0]?.value ?? null)}
          note="Both sides of a change correct"
        />
        <Stat
          label="Completed runs"
          value={count(summaries.length)}
          note={
            scope === null
              ? undefined
              : `${accuracyRanked.length} on dataset v${scope.datasetVersion}${scope.split === null ? '' : `/${scope.split}`}`
          }
        />
      </div>

      {excluded.length > 0 && (
        <Note tone="warn">
          {excluded.length} completed run(s) were scored on a different dataset version or split
          and are left out of the leaderboard below — scores from different case sets are not
          directly comparable. See the Runs page for the full list.
        </Note>
      )}

      <h2>Leaderboard</h2>
      <p className="lede">
        Primary track: does the model get the right verdict at the head revision — the PR as it
        actually stands. See the{' '}
        <Link href="/leaderboard/accuracy">base+head combined leaderboard</Link> for the secondary,
        counterfactual-reasoning track (does the model also get the pre-change state right).
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th className="wrap">Configuration</th>
              <th className="num">n</th>
              <th className="num">Accuracy (head)</th>
              <th className="num">95% interval</th>
              <th className="num">FAIL recall</th>
              <th className="num">Flip pairs</th>
              <th className="num">Cost / test</th>
            </tr>
          </thead>
          <tbody>
            {accuracyRanked.map((entry) => (
              <tr key={entry.summary.runId}>
                <td className="muted">{entry.rank}</td>
                <td className="wrap">
                  <Link href={`/runs/${entry.summary.runId}`}>{entry.summary.modelName}</Link>{' '}
                  <span className="muted">
                    · {entry.summary.promptName} v{entry.summary.promptVersion} ·{' '}
                    {entry.summary.contextStrategy}
                  </span>
                </td>
                <td className="num muted">{entry.summary.metrics.headCount}</td>
                <td className="num">
                  {percent(entry.value)} <Bar value={entry.value} />
                </td>
                <td className="num muted">
                  {intervalText(
                    entry.summary.metrics.headAccuracyInterval.lower,
                    entry.summary.metrics.headAccuracyInterval.upper,
                  ) ?? '—'}
                </td>
                <td className="num">{percent(entry.summary.metrics.classification.fail.recall)}</td>
                <td className="num">{percent(entry.summary.metrics.flipPairs.accuracy)}</td>
                <td className="num">{money(entry.summary.metrics.cost.costPerTest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Trade-offs</h2>
      <div className="split">
        <div className="card">
          <h3>Accuracy (head) vs cost</h3>
          <ScatterChart
            points={paretoPoints(summaries, 'costPerTest', 'headAccuracy')}
            xLabel="cost per test"
            yLabel="accuracy (head)"
            formatX={(value) => money(value)}
            formatY={(value) => percent(value, 0)}
          />
        </div>
        <div className="card">
          <h3>Accuracy (head) vs latency</h3>
          <ScatterChart
            points={paretoPoints(summaries, 'latencyP95', 'headAccuracy')}
            xLabel="p95 latency"
            yLabel="accuracy (head)"
            formatX={(value) => `${Math.round(value)} ms`}
            formatY={(value) => percent(value, 0)}
          />
        </div>
        <div className="card">
          <h3>FAIL recall vs cost</h3>
          <ScatterChart
            points={paretoPoints(summaries, 'costPerTest', 'failRecall')}
            xLabel="cost per test"
            yLabel="FAIL recall"
            formatX={(value) => money(value)}
            formatY={(value) => percent(value, 0)}
          />
        </div>
        <div className="card">
          <h3>Accuracy (head) vs coverage</h3>
          <ScatterChart
            points={summaries
              .filter(
                (summary) =>
                  summary.metrics.selective.coverage !== null &&
                  summary.metrics.headAccuracy !== null,
              )
              .map((summary) => ({
                id: summary.runId,
                label: `${summary.modelName} · ${summary.promptName} v${summary.promptVersion}`,
                x: summary.metrics.selective.coverage as number,
                y: summary.metrics.headAccuracy as number,
                onFront: false,
              }))}
            xLabel="coverage"
            yLabel="accuracy (head)"
            formatX={(value) => percent(value, 0)}
            formatY={(value) => percent(value, 0)}
          />
        </div>
      </div>

      <h2>Highlights</h2>
      <div className="grid">
        {highlights.map((highlight) => (
          <Stat
            key={highlight.id}
            label={highlight.label}
            value={highlight.summary?.modelName ?? '—'}
            note={
              highlight.summary === null
                ? 'no data'
                : `${highlight.summary.promptName} v${highlight.summary.promptVersion} · run ${shortId(highlight.summary.runId)}`
            }
          />
        ))}
      </div>
    </>
  );
}
