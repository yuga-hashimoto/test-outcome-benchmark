import { formalBenchmarkRuns } from '@tob/core';
import { listRunSummaries } from '@tob/db';
import { LeaderboardView } from '@/components/LeaderboardView';
import { db } from '@/lib/db';

export const dynamic = 'force-static';

export default function LeaderboardIndexPage() {
  return (
    <LeaderboardView summaries={formalBenchmarkRuns(listRunSummaries(db()))} metric="headAccuracy" />
  );
}
