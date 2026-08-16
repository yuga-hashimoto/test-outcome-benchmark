import { listRunSummaries } from '@tob/db';
import { LeaderboardView } from '@/components/LeaderboardView';
import { db } from '@/lib/db';

export const dynamic = 'force-static';

export default function LeaderboardIndexPage() {
  return <LeaderboardView summaries={listRunSummaries(db())} metric="accuracy" />;
}
