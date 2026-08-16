export const percent = (value: number | null, digits = 1): string =>
  value === null ? '—' : `${(value * 100).toFixed(digits)}%`;

export const score = (value: number | null, digits = 3): string =>
  value === null ? '—' : value.toFixed(digits);

export const money = (value: number | null): string => {
  if (value === null) return '—';
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
};

export const millis = (value: number | null): string =>
  value === null ? '—' : `${Math.round(value)}ms`;

export const count = (value: number): string => value.toLocaleString('en-US');

/** Renders an interval as "72.3% (64.1–79.8%)", or just the estimate when the
 * sample could not support an interval. */
export const interval = (
  estimate: number | null,
  lower: number | null,
  upper: number | null,
): string => {
  if (estimate === null) return '—';
  if (lower === null || upper === null) return percent(estimate);
  return `${percent(estimate)} (${percent(lower)}–${percent(upper)})`;
};

export const table = (rows: readonly (readonly string[])[]): string => {
  if (rows.length === 0) return '';
  const columns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_unused, index) =>
    Math.max(...rows.map((row) => (row[index] ?? '').length)),
  );

  return rows
    .map((row) =>
      row
        .map((cell, index) =>
          index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0),
        )
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
};

export const heading = (text: string): string => `\n${text}\n${'─'.repeat(text.length)}`;
