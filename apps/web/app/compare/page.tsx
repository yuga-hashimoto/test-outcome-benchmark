import Link from 'next/link';
import { getRunMetrics, listRuns } from '@tob/db';
import { compareRuns } from '@tob/runner';
import { Empty, Note, Stat } from '@/components/Stat';
import { db } from '@/lib/db';
import { count, percent, shortId } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ baseline?: string; candidate?: string }>;
}) {
  const { baseline, candidate } = await searchParams;
  const handle = db();
  const runs = listRuns(handle, 200).filter((run) => getRunMetrics(handle, run.id) !== null);

  if (runs.length < 2) {
    return (
      <>
        <h1>Compare runs</h1>
        <Empty>At least two completed runs are needed for a comparison.</Empty>
      </>
    );
  }

  const baselineRun = runs.find((run) => run.id === baseline);
  const candidateRun = runs.find((run) => run.id === candidate);
  const comparison =
    baselineRun !== undefined && candidateRun !== undefined && baselineRun.id !== candidateRun.id
      ? compareRuns(handle, baselineRun.id, candidateRun.id)
      : null;

  const includesZero =
    comparison !== null &&
    comparison.interval.lower !== null &&
    comparison.interval.upper !== null &&
    comparison.interval.lower <= 0 &&
    comparison.interval.upper >= 0;

  return (
    <>
      <h1>Compare runs</h1>
      <p className="lede">
        A paired comparison over the cases both runs scored. Pairing removes case difficulty from
        the difference, so the interval reflects the configurations rather than the dataset.
      </p>

      <div className="split" style={{ marginTop: 18 }}>
        {(['baseline', 'candidate'] as const).map((role) => (
          <div key={role} className="card">
            <h3>{role}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {runs.map((run) => {
                const selected = role === 'baseline' ? baseline : candidate;
                const other = role === 'baseline' ? candidate : baseline;
                const query = new URLSearchParams();
                if (role === 'baseline') {
                  query.set('baseline', run.id);
                  if (other !== undefined) query.set('candidate', other);
                } else {
                  if (other !== undefined) query.set('baseline', other);
                  query.set('candidate', run.id);
                }
                return (
                  <Link
                    key={run.id}
                    href={`/compare?${query.toString()}`}
                    style={{
                      padding: '5px 9px',
                      borderRadius: 7,
                      textDecoration: 'none',
                      fontSize: 13,
                      background: run.id === selected ? 'var(--accent-soft)' : 'transparent',
                      color: run.id === selected ? 'var(--accent)' : 'var(--muted)',
                    }}
                  >
                    {run.name}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {comparison === null ? (
        <Note>Pick a baseline and a candidate above.</Note>
      ) : (
        <>
          <div className="grid" style={{ marginTop: 20 }}>
            <Stat
              label="Baseline accuracy"
              value={percent(comparison.baselineAccuracy)}
              note={baselineRun?.name}
            />
            <Stat
              label="Candidate accuracy"
              value={percent(comparison.candidateAccuracy)}
              note={candidateRun?.name}
            />
            <Stat
              label="Difference"
              value={
                comparison.deltaAccuracy === null
                  ? '—'
                  : `${comparison.deltaAccuracy >= 0 ? '+' : ''}${percent(comparison.deltaAccuracy)}`
              }
              note={
                comparison.interval.lower === null || comparison.interval.upper === null
                  ? 'interval unavailable'
                  : `95%: ${percent(comparison.interval.lower)} to ${percent(comparison.interval.upper)}`
              }
            />
            <Stat
              label="Matched cases"
              value={count(comparison.matchedCases)}
              note={`${count(comparison.interval.clusters)} pull requests`}
            />
          </div>

          {includesZero ? (
            <Note tone="warn">
              The interval includes zero. On this dataset, these two configurations are not
              distinguishable — the observed gap is within what resampling produces by chance.
            </Note>
          ) : (
            <Note>
              The interval excludes zero, so the difference survives resampling whole pull requests.
            </Note>
          )}

          {!comparison.sameDatasetVersion && (
            <Note tone="warn">
              These runs used different dataset versions. Only the cases they share are compared,
              and the shared subset may not be representative of either full dataset.
            </Note>
          )}

          <p className="lede mono">
            baseline {shortId(comparison.baselineRunId)} · candidate{' '}
            {shortId(comparison.candidateRunId)}
          </p>
        </>
      )}
    </>
  );
}
