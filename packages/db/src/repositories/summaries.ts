import { desc, eq } from 'drizzle-orm';
import { runMetrics, runs } from '../schema';
import type { ContextStrategy, RunSummary } from '@tob/core';
import type { Db } from '../client';

/**
 * Flattens completed runs into the shape the leaderboard and comparison views
 * consume. Runs without stored metrics are omitted: an unfinished run has no
 * place on a ranking.
 */
export const listRunSummaries = (db: Db, limit = 200): RunSummary[] =>
  db
    .select({ run: runs, metrics: runMetrics })
    .from(runs)
    .innerJoin(runMetrics, eq(runMetrics.runId, runs.id))
    .orderBy(desc(runs.createdAt))
    .limit(limit)
    .all()
    .map(({ run, metrics }) => ({
      runId: run.id,
      runName: run.name,
      modelConfigId: run.modelConfigId,
      modelName: run.snapshot.modelName,
      provider: run.snapshot.provider,
      model: run.snapshot.model,
      settings: run.snapshot.settings,
      promptId: run.promptId,
      promptName: run.snapshot.promptName,
      promptVersion: run.snapshot.promptVersion,
      promptHash: run.snapshot.promptHash,
      contextStrategy: run.contextStrategy as ContextStrategy,
      datasetVersionId: run.datasetVersionId,
      datasetVersion: run.snapshot.datasetVersion,
      finishedAt: run.finishedAt,
      metrics: metrics.metrics,
    }));

export const getRunSummary = (db: Db, runId: string): RunSummary | null =>
  listRunSummaries(db).find((summary) => summary.runId === runId) ?? null;
