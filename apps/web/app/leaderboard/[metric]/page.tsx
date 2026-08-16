import { notFound } from 'next/navigation';
import { LEADERBOARD_METRICS, formalBenchmarkRuns } from '@tob/core';
import { listRunSummaries } from '@tob/db';
import { LeaderboardView } from '@/components/LeaderboardView';
import { db } from '@/lib/db';
import type { LeaderboardMetric } from '@tob/core';

export const dynamic = 'force-static';

/** One page per metric, so metric selection survives a static export. */
export function generateStaticParams(): { metric: string }[] {
  return LEADERBOARD_METRICS.map((metric) => ({ metric }));
}

export default async function LeaderboardMetricPage({
  params,
}: {
  params: Promise<{ metric: string }>;
}) {
  const { metric } = await params;
  if (!(LEADERBOARD_METRICS as readonly string[]).includes(metric)) notFound();

  return (
    <LeaderboardView
      summaries={formalBenchmarkRuns(listRunSummaries(db()))}
      metric={metric as LeaderboardMetric}
    />
  );
}
