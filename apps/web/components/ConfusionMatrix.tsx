import { count, percent } from '@/lib/format';
import type { ConfusionMatrix as Matrix } from '@tob/core';

/**
 * The four cells are not equally interesting. A real failure predicted to pass
 * is the one that costs something in practice, so it is the only cell given
 * emphatic colour.
 */
export function ConfusionMatrix({ matrix }: { matrix: Matrix }) {
  const cells = [
    { label: 'gold PASS · predicted PASS', value: matrix.goldPassPredictedPass, tone: 'good' },
    { label: 'gold PASS · predicted FAIL', value: matrix.goldPassPredictedFail, tone: 'plain' },
    { label: 'gold FAIL · predicted PASS', value: matrix.goldFailPredictedPass, tone: 'bad' },
    { label: 'gold FAIL · predicted FAIL', value: matrix.goldFailPredictedFail, tone: 'good' },
  ] as const;

  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(150px, 1fr))' }}>
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="card"
            style={{
              background:
                cell.tone === 'bad'
                  ? 'var(--danger-soft)'
                  : cell.tone === 'good'
                    ? 'var(--accent-soft)'
                    : 'var(--surface)',
              borderColor: cell.tone === 'plain' ? 'var(--border)' : 'transparent',
            }}
          >
            <div className="stat-label">{cell.label}</div>
            <div className="stat-value">{count(cell.value)}</div>
            <div className="stat-note">
              {matrix.total === 0 ? '—' : percent(cell.value / matrix.total)} of resolved
            </div>
          </div>
        ))}
      </div>
      <p className="note">
        The bottom-left cell is the expensive one: tests that really fail, predicted to pass.
      </p>
    </div>
  );
}
