import { asc, eq } from 'drizzle-orm';
import { predictions } from '../schema';
import { newId, nowIso } from '../ids';
import type {
  Evidence,
  LatencyMeasurement,
  PredictedVerdict,
  PredictionErrorRecord,
  PredictionRecord,
  TokenUsage,
  Verdict,
} from '@tob/core';
import type { Db } from '../client';

export interface RecordPredictionInput {
  readonly runId: string;
  readonly caseId: string;
  readonly repetition: number;
  readonly goldVerdict: Verdict;
  readonly predictedVerdict: PredictedVerdict | null;
  readonly confidence: number | null;
  readonly reason: string | null;
  readonly evidence: readonly Evidence[];
  readonly requiresRuntimeInformation: boolean | null;
  readonly rawResponse: string;
  readonly usage: TokenUsage;
  readonly latency: LatencyMeasurement | null;
  readonly costUsd: number | null;
  readonly error: PredictionErrorRecord | null;
  readonly warnings: readonly string[];
}

const toRecord = (row: typeof predictions.$inferSelect): PredictionRecord => ({
  id: row.id,
  runId: row.runId,
  caseId: row.caseId,
  repetition: row.repetition,
  goldVerdict: row.goldVerdict,
  predictedVerdict: row.predictedVerdict,
  confidence: row.confidence,
  reason: row.reason,
  evidence: row.evidence,
  requiresRuntimeInformation: row.requiresRuntimeInformation,
  rawResponse: row.rawResponse,
  usage: row.usage,
  latency: row.latency ?? null,
  costUsd: row.costUsd,
  error: row.error ?? null,
  createdAt: row.createdAt,
});

/**
 * Written one attempt at a time and immediately, so an interrupted run keeps
 * everything it had already produced. `onConflictDoNothing` on the
 * (run, case, repetition) index makes a resumed run idempotent rather than
 * duplicating work it already paid for.
 */
export const recordPrediction = (db: Db, input: RecordPredictionInput): void => {
  db.insert(predictions)
    .values({
      id: newId('pred'),
      runId: input.runId,
      caseId: input.caseId,
      repetition: input.repetition,
      goldVerdict: input.goldVerdict,
      predictedVerdict: input.predictedVerdict,
      confidence: input.confidence,
      reason: input.reason,
      evidence: [...input.evidence],
      requiresRuntimeInformation: input.requiresRuntimeInformation,
      rawResponse: input.rawResponse,
      usage: input.usage,
      latency: input.latency,
      costUsd: input.costUsd,
      error: input.error,
      warnings: [...input.warnings],
      createdAt: nowIso(),
    })
    .onConflictDoNothing()
    .run();
};

export const listPredictions = (db: Db, runId: string): PredictionRecord[] =>
  db
    .select()
    .from(predictions)
    .where(eq(predictions.runId, runId))
    .orderBy(asc(predictions.caseId), asc(predictions.repetition))
    .all()
    .map(toRecord);

/** Attempts already on disk, so a resumed run knows what is left to do. */
export const completedAttempts = (db: Db, runId: string): Set<string> => {
  const rows = db
    .select({ caseId: predictions.caseId, repetition: predictions.repetition })
    .from(predictions)
    .where(eq(predictions.runId, runId))
    .all();

  return new Set(rows.map((row) => `${row.caseId}::${row.repetition}`));
};

export const countPredictions = (db: Db, runId: string): number =>
  db.select({ id: predictions.id }).from(predictions).where(eq(predictions.runId, runId)).all()
    .length;

export const listWarnings = (db: Db, runId: string): Record<string, number> => {
  const rows = db
    .select({ warnings: predictions.warnings })
    .from(predictions)
    .where(eq(predictions.runId, runId))
    .all();

  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const warning of row.warnings) {
      counts[warning] = (counts[warning] ?? 0) + 1;
    }
  }
  return counts;
};
