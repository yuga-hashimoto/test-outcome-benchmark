import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRun } from '@tob/db';
import { compareRuns } from '@tob/runner';
import { Note, Stat } from '@/components/Stat';
import { comparableRuns } from '@/lib/comparable';
import { db } from '@/lib/db';
import { count, percent, shortId } from '@/lib/format';

export const dynamic = 'force-static';

/** Every ordered pair, so a static export can serve any comparison. */
export function generateStaticParams(): { baseline: string; candidate: string }[] {
  const runs = comparableRuns();
  return runs.flatMap((baseline) =>
    runs
      .filter((candidate) => candidate.id !== baseline.id)
      .map((candidate) => ({ baseline: baseline.id, candidate: candidate.id })),
  );
}

export default async function ComparePairPage({
  params,
}: {
  params: Promise<{ baseline: string; candidate: string }>;
}) {
  const { baseline, candidate } = await params;
  const handle = db();

  const baselineRun = getRun(handle, baseline);
  const candidateRun = getRun(handle, candidate);
  if (baselineRun === null || candidateRun === null || baseline === candidate) notFound();

  const comparison = compareRuns(handle, baseline, candidate);

  const includesZero =
    comparison.interval.lower !== null &&
    comparison.interval.upper !== null &&
    comparison.interval.lower <= 0 &&
    comparison.interval.upper >= 0;

  return (
    <>
      <h1>Paired comparison</h1>
      <p className="lede">
        <Link href="/compare">← all comparisons</Link>
      </p>

      <div className="grid" style={{ marginTop: 18 }}>
        <Stat
          label="Baseline accuracy"
          value={percent(comparison.baselineAccuracy)}
          note={baselineRun.name}
        />
        <Stat
          label="Candidate accuracy"
          value={percent(comparison.candidateAccuracy)}
          note={candidateRun.name}
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
          The interval includes zero. On this dataset these two configurations are not
          distinguishable — the observed gap is within what resampling produces by chance.
        </Note>
      ) : (
        <Note>
          The interval excludes zero, so the difference survives resampling whole pull requests.
        </Note>
      )}

      {!comparison.sameDatasetVersion && (
        <Note tone="warn">
          These runs used different dataset versions. Only the cases they share are compared, and
          that shared subset may not represent either full dataset.
        </Note>
      )}

      <h2>Configurations</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th></th>
              <th className="wrap">Baseline</th>
              <th className="wrap">Candidate</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['Run', baselineRun.name, candidateRun.name],
                ['Model', baselineRun.snapshot.model, candidateRun.snapshot.model],
                [
                  'Prompt',
                  `${baselineRun.snapshot.promptName} v${baselineRun.snapshot.promptVersion}`,
                  `${candidateRun.snapshot.promptName} v${candidateRun.snapshot.promptVersion}`,
                ],
                [
                  'Context',
                  baselineRun.config.contextStrategy,
                  candidateRun.config.contextStrategy,
                ],
                [
                  'Dataset',
                  `v${baselineRun.snapshot.datasetVersion}`,
                  `v${candidateRun.snapshot.datasetVersion}`,
                ],
                [
                  'Repetitions',
                  String(baselineRun.config.repetitions),
                  String(candidateRun.config.repetitions),
                ],
              ] as const
            ).map(([label, left, right]) => (
              <tr key={label}>
                <td className="muted">{label}</td>
                <td className="wrap">{left}</td>
                <td className="wrap">{right}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="lede mono" style={{ marginTop: 16 }}>
        <Link href={`/runs/${baseline}`}>{shortId(baseline)}</Link> ·{' '}
        <Link href={`/runs/${candidate}`}>{shortId(candidate)}</Link>
      </p>
    </>
  );
}
