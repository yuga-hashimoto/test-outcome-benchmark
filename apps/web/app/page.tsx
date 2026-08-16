import Link from 'next/link';
import { dashboardHighlights, paretoFront, rankRuns } from '@tob/core';
import { listRunSummaries } from '@tob/db';
import { ScatterChart } from '@/components/ScatterChart';
import { Bar, Empty, Note, Stat } from '@/components/Stat';
import { db } from '@/lib/db';
import { count, intervalText, money, percent, shortId } from '@/lib/format';
import type { LeaderboardMetric, RunSummary } from '@tob/core';

export const dynamic = 'force-dynamic';

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
  const summaries = listRunSummaries(db());

  if (summaries.length === 0) {
    return (
      <>
        <h1>Dashboard</h1>
        <p className="lede">
          How accurately does a model predict the real PASS/FAIL outcome of a natural-language test
          case, given the pull request it runs against?
        </p>
        <Empty>
          No completed runs yet. Seed the database and run the benchmark with the mock provider —
          no API key required.
          <pre style={{ marginTop: 14, textAlign: 'left' }}>
            pnpm seed{'\n'}pnpm benchmark run --model mock-thorough --prompt reasoning-v1
          </pre>
        </Empty>
      </>
    );
  }

  const best = rankRuns(summaries, 'accuracy')[0];
  const highlights = dashboardHighlights(summaries);
  const versions = new Set(summaries.map((summary) => summary.datasetVersion));

  return (
    <>
      <h1>Dashboard</h1>
      <p className="lede">
        How accurately does a model predict the real PASS/FAIL outcome of a natural-language test
        case, given the pull request it runs against?
      </p>

      <div className="grid" style={{ marginTop: 20 }}>
        <Stat
          label="Best accuracy"
          value={percent(best?.value ?? null)}
          note={
            best === undefined
              ? undefined
              : (intervalText(
                  best.summary.metrics.accuracyInterval.lower,
                  best.summary.metrics.accuracyInterval.upper,
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
          value={percent(rankRuns(summaries, 'flipPairAccuracy')[0]?.value ?? null)}
          note="Both sides of a change correct"
        />
        <Stat label="Completed runs" value={count(summaries.length)} note={`${versions.size} dataset version${versions.size === 1 ? '' : 's'}`} />
      </div>

      {versions.size > 1 && (
        <Note tone="warn">
          These runs span {versions.size} dataset versions. Scores from different case sets are not
          directly comparable — filter to a single version before reading a ranking as a
          head-to-head.
        </Note>
      )}

      <h2>Leaderboard</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th className="wrap">Configuration</th>
              <th>Data</th>
              <th className="num">Accuracy</th>
              <th className="num">95% interval</th>
              <th className="num">FAIL recall</th>
              <th className="num">Flip pairs</th>
              <th className="num">Cost / test</th>
            </tr>
          </thead>
          <tbody>
            {rankRuns(summaries, 'accuracy').map((entry) => (
              <tr key={entry.summary.runId}>
                <td className="muted">{entry.rank}</td>
                <td className="wrap">
                  <Link href={`/runs/${entry.summary.runId}`}>{entry.summary.modelName}</Link>{' '}
                  <span className="muted">
                    · {entry.summary.promptName} v{entry.summary.promptVersion} ·{' '}
                    {entry.summary.contextStrategy}
                  </span>
                </td>
                <td className="muted">v{entry.summary.datasetVersion}</td>
                <td className="num">
                  {percent(entry.value)} <Bar value={entry.value} />
                </td>
                <td className="num muted">
                  {intervalText(
                    entry.summary.metrics.accuracyInterval.lower,
                    entry.summary.metrics.accuracyInterval.upper,
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
          <h3>Accuracy vs cost</h3>
          <ScatterChart
            points={paretoPoints(summaries, 'costPerTest', 'accuracy')}
            xLabel="cost per test"
            yLabel="accuracy"
            formatX={(value) => money(value)}
            formatY={(value) => percent(value, 0)}
          />
        </div>
        <div className="card">
          <h3>Accuracy vs latency</h3>
          <ScatterChart
            points={paretoPoints(summaries, 'latencyP95', 'accuracy')}
            xLabel="p95 latency"
            yLabel="accuracy"
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
          <h3>Accuracy vs coverage</h3>
          <ScatterChart
            points={summaries
              .filter(
                (summary) =>
                  summary.metrics.selective.coverage !== null &&
                  summary.metrics.accuracy !== null,
              )
              .map((summary) => ({
                id: summary.runId,
                label: `${summary.modelName} · ${summary.promptName} v${summary.promptVersion}`,
                x: summary.metrics.selective.coverage as number,
                y: summary.metrics.accuracy as number,
                onFront: false,
              }))}
            xLabel="coverage"
            yLabel="accuracy"
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
