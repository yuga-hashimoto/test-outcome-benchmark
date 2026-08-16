import Link from 'next/link';
import { rankRunsInScope } from '@tob/core';
import { listRunSummaries } from '@tob/db';
import { compareRuns } from '@tob/runner';
import { Empty, Note } from '@/components/Stat';
import { comparableRuns } from '@/lib/comparable';
import { db } from '@/lib/db';
import { percent, shortId } from '@/lib/format';

export const dynamic = 'force-static';

export default function CompareIndexPage() {
  const handle = db();
  const runs = comparableRuns();

  if (runs.length < 2) {
    return (
      <>
        <h1>Compare runs</h1>
        <Empty>At least two completed runs are needed for a comparison.</Empty>
      </>
    );
  }

  const runIds = new Set(runs.map((run) => run.id));
  const summaries = listRunSummaries(handle, 200).filter((summary) => runIds.has(summary.runId));
  const leader = rankRunsInScope(summaries, 'accuracy').ranked[0];

  if (leader === undefined) {
    return (
      <>
        <h1>Compare runs</h1>
        <Empty>No run has a measurable accuracy yet.</Empty>
      </>
    );
  }

  const rows = runs
    .filter((run) => run.id !== leader.summary.runId)
    .map((run) => ({ run, comparison: compareRuns(handle, leader.summary.runId, run.id) }));

  return (
    <>
      <h1>Compare runs</h1>
      <p className="lede">
        Every run measured against the current leader, paired over the cases both scored. Pairing
        removes case difficulty from the difference, so the interval describes the configurations
        rather than the dataset.
      </p>

      <h2>Against {leader.summary.modelName}</h2>
      <p className="lede">
        Baseline: <Link href={`/runs/${leader.summary.runId}`}>{leader.summary.runName}</Link> at{' '}
        {percent(leader.value)} accuracy.
      </p>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="wrap">Candidate</th>
              <th className="num">Accuracy</th>
              <th className="num">Difference</th>
              <th className="num">95% interval</th>
              <th>Distinguishable?</th>
              <th className="num">Cases</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ run, comparison }) => {
              const decided =
                comparison.interval.lower !== null &&
                comparison.interval.upper !== null &&
                (comparison.interval.lower > 0 || comparison.interval.upper < 0);

              return (
                <tr key={run.id}>
                  <td className="wrap">
                    <Link href={`/compare/${leader.summary.runId}/${run.id}`}>{run.name}</Link>
                  </td>
                  <td className="num">{percent(comparison.candidateAccuracy)}</td>
                  <td className="num">
                    {comparison.deltaAccuracy === null
                      ? '—'
                      : `${comparison.deltaAccuracy >= 0 ? '+' : ''}${percent(comparison.deltaAccuracy)}`}
                  </td>
                  <td className="num muted">
                    {comparison.interval.lower === null || comparison.interval.upper === null
                      ? '—'
                      : `${percent(comparison.interval.lower)} to ${percent(comparison.interval.upper)}`}
                  </td>
                  <td>
                    {decided ? (
                      <span className="pill pill-pass">yes</span>
                    ) : (
                      <span className="pill pill-warn">not distinguishable</span>
                    )}
                  </td>
                  <td className="num muted">{comparison.matchedCases}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Note>
        &ldquo;Not distinguishable&rdquo; means the 95% interval on the difference includes zero:
        the observed gap is within what resampling whole pull requests produces by chance. It does
        not mean the two configurations are equal, only that this dataset cannot separate them.
      </Note>

      <h2>All pairs</h2>
      <p className="lede">Pick any two runs for the full paired comparison.</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="wrap">Baseline</th>
              <th className="wrap">Compare with</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((baseline) => (
              <tr key={baseline.id}>
                <td className="wrap">
                  {baseline.name} <span className="muted mono">{shortId(baseline.id)}</span>
                </td>
                <td className="wrap">
                  {runs
                    .filter((candidate) => candidate.id !== baseline.id)
                    .map((candidate) => (
                      <Link
                        key={candidate.id}
                        href={`/compare/${baseline.id}/${candidate.id}`}
                        className="pill"
                        style={{ marginRight: 4, marginBottom: 4, display: 'inline-block' }}
                      >
                        {candidate.snapshot.modelName} · {candidate.snapshot.promptName}
                      </Link>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
