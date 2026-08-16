import Link from 'next/link';
import { getRunMetrics, listRuns } from '@tob/db';
import { Empty } from '@/components/Stat';
import { db } from '@/lib/db';
import { dateTime, percent, shortId } from '@/lib/format';

export const dynamic = 'force-dynamic';

const statusPill = (status: string): string => {
  if (status === 'COMPLETED') return 'pill pill-pass';
  if (status === 'FAILED') return 'pill pill-fail';
  if (status === 'CANCELLED' || status === 'RUNNING') return 'pill pill-warn';
  return 'pill';
};

export default function RunsPage() {
  const handle = db();
  const runs = listRuns(handle, 200);

  if (runs.length === 0) {
    return (
      <>
        <h1>Runs</h1>
        <Empty>No runs yet.</Empty>
      </>
    );
  }

  return (
    <>
      <h1>Runs</h1>
      <p className="lede">
        Every run keeps a snapshot of the dataset version, prompt text and pricing in force when it
        started, so its numbers stay interpretable after those change.
      </p>

      <div className="table-scroll" style={{ marginTop: 18 }}>
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th className="wrap">Configuration</th>
              <th>Status</th>
              <th className="num">Progress</th>
              <th className="num">Accuracy</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const metrics = getRunMetrics(handle, run.id);
              return (
                <tr key={run.id}>
                  <td className="mono">
                    <Link href={`/runs/${run.id}`}>{shortId(run.id)}</Link>
                  </td>
                  <td className="wrap">{run.name}</td>
                  <td>
                    <span className={statusPill(run.status)}>{run.status.toLowerCase()}</span>
                  </td>
                  <td className="num muted">
                    {run.completedPredictions}/{run.totalPredictions}
                  </td>
                  <td className="num">{percent(metrics?.accuracy ?? null)}</td>
                  <td className="muted">{dateTime(run.startedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
