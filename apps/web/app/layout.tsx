import Link from 'next/link';
import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Test Outcome Benchmark',
  description:
    'How accurately does a model predict the real PASS/FAIL outcome of a natural-language test from a pull request?',
};

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/runs', label: 'Runs' },
  { href: '/leaderboard', label: 'Leaderboards' },
  { href: '/compare', label: 'Compare' },
  { href: '/datasets', label: 'Dataset' },
  { href: '/prompts', label: 'Prompts' },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <nav className="sidebar">
            <div className="brand">Test Outcome Benchmark</div>
            <div className="brand-sub">Model × Prompt × Context</div>
            <div className="nav">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
