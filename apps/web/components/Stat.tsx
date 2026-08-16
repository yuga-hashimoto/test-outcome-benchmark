import type { ReactNode } from 'react';

export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note !== undefined && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Note({ children, tone }: { children: ReactNode; tone?: 'warn' }) {
  return <p className={tone === 'warn' ? 'note note-warn' : 'note'}>{children}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** A proportion rendered as a small inline bar, for scanning a column quickly. */
export function Bar({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>;
  return (
    <span className="bar-track" aria-hidden="true">
      <span className="bar-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

export function Verdict({ value }: { value: string | null }) {
  if (value === null) return <span className="pill pill-warn">no verdict</span>;
  if (value === 'PASS') return <span className="pill pill-pass">PASS</span>;
  if (value === 'FAIL') return <span className="pill pill-fail">FAIL</span>;
  return <span className="pill">{value}</span>;
}
