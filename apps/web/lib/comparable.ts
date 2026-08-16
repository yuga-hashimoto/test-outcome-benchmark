import { getRunMetrics, listRuns } from '@tob/db';
import { db } from './db';
import type { BenchmarkRun } from '@tob/core';

/**
 * Runs eligible for pairwise comparison, newest first and capped.
 *
 * The cap exists because a static export pre-renders every ordered pair, and
 * that count grows with the square of the run list. Twenty runs is 380 pages,
 * which is still a fast build; letting it grow unbounded is not.
 */
export const MAX_COMPARABLE_RUNS = 20;

export const comparableRuns = (): BenchmarkRun[] => {
  const handle = db();
  return listRuns(handle, 200)
    .filter((run) => getRunMetrics(handle, run.id) !== null)
    .slice(0, MAX_COMPARABLE_RUNS);
};
