import { desc, eq, sql } from 'drizzle-orm';
import { runMetrics, runs } from '../schema';
import { newId, nowIso } from '../ids';
import type {
  BenchmarkRun,
  ContextStrategy,
  RunConfiguration,
  RunMetrics,
  RunSnapshot,
  RunStatus,
} from '@tob/core';
import type { Db } from '../client';

const toRun = (row: typeof runs.$inferSelect): BenchmarkRun => ({
  id: row.id,
  name: row.name,
  status: row.status as RunStatus,
  config: row.config,
  snapshot: row.snapshot,
  totalPredictions: row.totalPredictions,
  completedPredictions: row.completedPredictions,
  createdAt: row.createdAt,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  error: row.error,
});

export interface CreateRunInput {
  readonly name: string;
  readonly config: RunConfiguration;
  readonly snapshot: RunSnapshot;
  readonly totalPredictions: number;
}

export const createRun = (db: Db, input: CreateRunInput): BenchmarkRun => {
  const record = {
    id: newId('run'),
    name: input.name,
    status: 'PENDING' as const,
    datasetVersionId: input.config.datasetVersionId,
    modelConfigId: input.config.modelConfigId,
    promptId: input.config.promptId,
    contextStrategy: input.config.contextStrategy as ContextStrategy,
    config: input.config,
    snapshot: input.snapshot,
    totalPredictions: input.totalPredictions,
    completedPredictions: 0,
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    error: null,
  };
  db.insert(runs).values(record).run();
  return toRun(record);
};

export const markRunStarted = (db: Db, runId: string): void => {
  db.update(runs).set({ status: 'RUNNING', startedAt: nowIso() }).where(eq(runs.id, runId)).run();
};

export const markRunFinished = (
  db: Db,
  runId: string,
  status: Extract<RunStatus, 'COMPLETED' | 'FAILED' | 'CANCELLED'>,
  error: string | null = null,
): void => {
  db.update(runs).set({ status, finishedAt: nowIso(), error }).where(eq(runs.id, runId)).run();
};

/** Incremented in SQL so concurrent workers cannot lose a count to a race. */
export const incrementCompleted = (db: Db, runId: string, by = 1): void => {
  db.update(runs)
    .set({ completedPredictions: sql`${runs.completedPredictions} + ${by}` })
    .where(eq(runs.id, runId))
    .run();
};

export const setCompletedCount = (db: Db, runId: string, value: number): void => {
  db.update(runs).set({ completedPredictions: value }).where(eq(runs.id, runId)).run();
};

export const getRun = (db: Db, runId: string): BenchmarkRun | null => {
  const row = db.select().from(runs).where(eq(runs.id, runId)).get();
  return row === undefined ? null : toRun(row);
};

export const listRuns = (db: Db, limit = 100): BenchmarkRun[] =>
  db.select().from(runs).orderBy(desc(runs.createdAt)).limit(limit).all().map(toRun);

export const saveRunMetrics = (
  db: Db,
  runId: string,
  metrics: RunMetrics,
  wallClockMs: number | null,
): void => {
  db.insert(runMetrics)
    .values({ runId, metrics, wallClockMs, computedAt: nowIso() })
    .onConflictDoUpdate({
      target: runMetrics.runId,
      set: { metrics, wallClockMs, computedAt: nowIso() },
    })
    .run();
};

export const getRunMetrics = (db: Db, runId: string): RunMetrics | null => {
  const row = db.select().from(runMetrics).where(eq(runMetrics.runId, runId)).get();
  return row === undefined ? null : row.metrics;
};

export const getRunWallClock = (db: Db, runId: string): number | null => {
  const row = db.select().from(runMetrics).where(eq(runMetrics.runId, runId)).get();
  return row?.wallClockMs ?? null;
};
