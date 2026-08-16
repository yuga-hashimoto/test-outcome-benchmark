import type { CalibrationBucket } from '@tob/core';

const WIDTH = 420;
const HEIGHT = 300;
const PAD = 42;

/**
 * Reliability diagram: stated confidence against observed accuracy, with the
 * diagonal marking perfect calibration. Point area encodes how many
 * predictions fell in each bucket, so a bucket of two is visibly a bucket of
 * two rather than a dramatic swing.
 */
export function CalibrationChart({ buckets }: { buckets: readonly CalibrationBucket[] }) {
  const populated = buckets.filter(
    (bucket) => bucket.count > 0 && bucket.accuracy !== null && bucket.meanConfidence !== null,
  );

  const maxCount = Math.max(1, ...populated.map((bucket) => bucket.count));
  const x = (value: number): number => PAD + value * (WIDTH - PAD - 12);
  const y = (value: number): number => HEIGHT - PAD - value * (HEIGHT - PAD - 12);

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Calibration: stated confidence against observed accuracy"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
        <g key={tick}>
          <line
            x1={PAD}
            x2={WIDTH - 12}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--border)"
            strokeWidth="1"
          />
          <text x={PAD - 8} y={y(tick) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">
            {Math.round(tick * 100)}%
          </text>
          <text
            x={x(tick)}
            y={HEIGHT - PAD + 16}
            textAnchor="middle"
            fontSize="10"
            fill="var(--muted)"
          >
            {Math.round(tick * 100)}%
          </text>
        </g>
      ))}

      <line
        x1={x(0)}
        y1={y(0)}
        x2={x(1)}
        y2={y(1)}
        stroke="var(--muted)"
        strokeWidth="1"
        strokeDasharray="4 4"
      />

      <polyline
        points={populated
          .map((bucket) => `${x(bucket.meanConfidence as number)},${y(bucket.accuracy as number)}`)
          .join(' ')}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />

      {populated.map((bucket) => (
        <circle
          key={bucket.lowerBound}
          cx={x(bucket.meanConfidence as number)}
          cy={y(bucket.accuracy as number)}
          r={3 + 5 * Math.sqrt(bucket.count / maxCount)}
          fill="var(--accent)"
          fillOpacity="0.75"
        >
          <title>{`confidence ${(bucket.meanConfidence as number).toFixed(2)}, accuracy ${((bucket.accuracy as number) * 100).toFixed(0)}%, n=${bucket.count}`}</title>
        </circle>
      ))}

      <text x={PAD} y={16} fontSize="11" fill="var(--muted)">
        observed accuracy
      </text>
      <text x={WIDTH - 12} y={HEIGHT - 8} textAnchor="end" fontSize="11" fill="var(--muted)">
        stated confidence
      </text>

      {populated.length === 0 && (
        <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" fontSize="12" fill="var(--muted)">
          No confidences were reported.
        </text>
      )}
    </svg>
  );
}
