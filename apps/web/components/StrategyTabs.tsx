'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Switches between server-rendered panels, one per context strategy. The
 * panels themselves are computed server-side (they need @tob/core, which
 * pulls in node:crypto and cannot be bundled for the browser) — this
 * component only holds which one is visible, so the client bundle never
 * imports @tob/core at all.
 */
export function StrategyTabs({
  strategies,
  defaultStrategy,
  panels,
}: {
  strategies: readonly string[];
  defaultStrategy: string;
  panels: Readonly<Record<string, ReactNode>>;
}) {
  const [selected, setSelected] = useState(defaultStrategy);

  return (
    <>
      <p className="lede" style={{ marginTop: 14, marginBottom: 4 }}>
        Track: which question the model was asked.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {strategies.map((item) => (
          <button
            key={item}
            type="button"
            className="pill"
            onClick={() => setSelected(item)}
            style={{
              cursor: 'pointer',
              border: '1px solid var(--border)',
              ...(item === selected
                ? {
                    background: 'var(--accent-soft)',
                    color: 'var(--accent)',
                    borderColor: 'transparent',
                  }
                : undefined),
            }}
          >
            {item}
          </button>
        ))}
      </div>
      {panels[selected]}
    </>
  );
}
