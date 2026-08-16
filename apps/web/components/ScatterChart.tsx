export interface ScatterPoint {
  /** Stable identity. Labels collide whenever two runs share a model and prompt. */
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly onFront: boolean;
}

const WIDTH = 440;
const HEIGHT = 300;
const PAD_LEFT = 52;
const PAD_BOTTOM = 40;

/**
 * A trade-off view such as accuracy against cost. Points on the Pareto front —
 * those nothing beats on both axes at once — are filled; dominated points are
 * hollow, so the shortlist reads at a glance.
 */
export function ScatterChart({
  points,
  xLabel,
  yLabel,
  formatX,
  formatY,
}: {
  points: readonly ScatterPoint[];
  xLabel: string;
  yLabel: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
}) {
  if (points.length === 0) {
    return <div className="empty">Not enough completed runs to plot this trade-off.</div>;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const spread = (min: number, max: number): [number, number] =>
    min === max ? [min - Math.abs(min || 1) * 0.5, max + Math.abs(max || 1) * 0.5] : [min, max];

  const [x0, x1] = spread(xMin, xMax);
  const [y0, y1] = spread(yMin, yMax);

  const px = (value: number): number =>
    PAD_LEFT + ((value - x0) / (x1 - x0)) * (WIDTH - PAD_LEFT - 16);
  const py = (value: number): number =>
    HEIGHT - PAD_BOTTOM - ((value - y0) / (y1 - y0)) * (HEIGHT - PAD_BOTTOM - 18);

  const ticks = [0, 0.5, 1];

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${yLabel} against ${xLabel}`}
    >
      {ticks.map((tick) => {
        const yValue = y0 + tick * (y1 - y0);
        const xValue = x0 + tick * (x1 - x0);
        return (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - 16}
              y1={py(yValue)}
              y2={py(yValue)}
              stroke="var(--border)"
            />
            <text
              x={PAD_LEFT - 8}
              y={py(yValue) + 4}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted)"
            >
              {formatY(yValue)}
            </text>
            <text
              x={px(xValue)}
              y={HEIGHT - PAD_BOTTOM + 16}
              textAnchor="middle"
              fontSize="10"
              fill="var(--muted)"
            >
              {formatX(xValue)}
            </text>
          </g>
        );
      })}

      {points.map((point) => (
        <circle
          key={point.id}
          cx={px(point.x)}
          cy={py(point.y)}
          r={point.onFront ? 6 : 4.5}
          fill={point.onFront ? 'var(--accent)' : 'none'}
          stroke="var(--accent)"
          strokeWidth="1.5"
          fillOpacity="0.85"
        >
          <title>{`${point.label}\n${xLabel}: ${formatX(point.x)}\n${yLabel}: ${formatY(point.y)}${point.onFront ? '\non the Pareto front' : ''}`}</title>
        </circle>
      ))}

      <text x={PAD_LEFT} y={14} fontSize="11" fill="var(--muted)">
        {yLabel}
      </text>
      <text x={WIDTH - 16} y={HEIGHT - 6} textAnchor="end" fontSize="11" fill="var(--muted)">
        {xLabel}
      </text>
    </svg>
  );
}
