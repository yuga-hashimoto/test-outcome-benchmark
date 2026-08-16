import { Verdict } from './Stat';
import { percent } from '@/lib/format';
import type { RunCaseDetail } from '@tob/db';

/**
 * The drill-down for wrong predictions. It shows the model's own stated reason
 * next to the case, because the useful question about a mistake is not that it
 * happened but what the model thought it was looking at.
 */
export function CaseTable({
  details,
  emptyMessage,
  limit = 25,
}: {
  details: readonly RunCaseDetail[];
  emptyMessage: string;
  limit?: number;
}) {
  if (details.length === 0) {
    return <div className="empty">{emptyMessage}</div>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th className="wrap">Test case</th>
            <th>Pattern</th>
            <th>Rev</th>
            <th>Gold</th>
            <th>Predicted</th>
            <th className="num">Confidence</th>
            <th className="wrap">Model reasoning</th>
          </tr>
        </thead>
        <tbody>
          {details.slice(0, limit).map((detail) => (
            <tr key={`${detail.prediction.caseId}-${detail.prediction.repetition}`}>
              <td className="wrap">
                <a
                  href={detail.benchmarkCase.metadata.provenance.prUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {detail.benchmarkCase.testCase.title}
                </a>
                <div className="muted mono" style={{ fontSize: 11.5 }}>
                  {detail.benchmarkCase.pr.repository}#{detail.benchmarkCase.pr.number}
                </div>
              </td>
              <td>
                <span className="pill">{detail.benchmarkCase.metadata.casePattern}</span>
              </td>
              <td className="muted">{detail.benchmarkCase.revision}</td>
              <td>
                <Verdict value={detail.prediction.goldVerdict} />
              </td>
              <td>
                <Verdict value={detail.prediction.predictedVerdict} />
              </td>
              <td className="num">{percent(detail.prediction.confidence)}</td>
              <td className="wrap muted">{detail.prediction.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {details.length > limit && (
        <div className="muted" style={{ padding: '9px 12px', fontSize: 12.5 }}>
          Showing {limit} of {details.length}.
        </div>
      )}
    </div>
  );
}
