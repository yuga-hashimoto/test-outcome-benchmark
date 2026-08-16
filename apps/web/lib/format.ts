export const percent = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined ? '—' : `${(value * 100).toFixed(digits)}%`;

export const score = (value: number | null | undefined, digits = 3): string =>
  value === null || value === undefined ? '—' : value.toFixed(digits);

export const money = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
};

export const millis = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${Math.round(value)} ms`;

export const count = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : value.toLocaleString('en-US');

export const intervalText = (
  lower: number | null,
  upper: number | null,
): string | null => (lower === null || upper === null ? null : `${percent(lower)} – ${percent(upper)}`);

export const shortId = (id: string): string => id.slice(0, 12);

export const dateTime = (value: string | null): string =>
  value === null ? '—' : new Date(value).toLocaleString('en-GB', { timeZone: 'UTC' });
