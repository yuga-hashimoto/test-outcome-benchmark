import {
  CancelledError,
  aggregateRunMetrics,
  applyDistribution,
} from '@tob/core';
import {
  buildEvaluatedPredictions,
  completedAttempts,
  getRunWallClock,
  incrementCompleted,
  markRunFinished,
  markRunStarted,
  recordPrediction,
  saveRunMetrics,
  setCompletedCount,
} from '@tob/db';
import { createLimiter } from './limit';
import { executePrediction } from './execute';
import type { BenchmarkCase, BenchmarkRun, ModelConfiguration, Prompt, RunMetrics } from '@tob/core';
import type { Db } from '@tob/db';
import type { ModelAdapter } from '@tob/providers';

export interface RunProgress {
  readonly completed: number;
  readonly total: number;
  readonly caseId: string;
  readonly repetition: number;
  readonly verdict: string | null;
  readonly errorKind: string | null;
}

export interface ExecuteRunOptions {
  readonly db: Db;
  readonly run: BenchmarkRun;
  readonly cases: readonly BenchmarkCase[];
  readonly prompt: Prompt;
  readonly modelConfig: ModelConfiguration;
  readonly adapter: ModelAdapter;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RunProgress) => void;
}

export interface ExecuteRunResult {
  readonly status: 'COMPLETED' | 'CANCELLED' | 'FAILED';
  readonly metrics: RunMetrics | null;
  readonly executed: number;
  readonly skipped: number;
  readonly wallClockMs: number;
}

interface Attempt {
  readonly benchmarkCase: BenchmarkCase;
  readonly repetition: number;
}

/**
 * Executes a run to completion, resuming whatever is already on disk.
 *
 * Each attempt is persisted the moment it finishes rather than at the end, so
 * an interrupted or cancelled run keeps everything it paid for and can be
 * resumed without repeating it.
 */
export const executeRun = async (options: ExecuteRunOptions): Promise<ExecuteRunResult> => {
  const { db, run } = options;
  const signal = options.signal ?? new AbortController().signal;
  const startedAt = Date.now();

  const selected = applyDistribution(
    options.cases,
    run.config.distribution,
    `${run.id}:distribution`,
  );

  const alreadyDone = completedAttempts(db, run.id);
  const attempts: Attempt[] = [];

  for (const benchmarkCase of selected) {
    for (let repetition = 0; repetition < run.config.repetitions; repetition += 1) {
      if (alreadyDone.has(`${benchmarkCase.id}::${repetition}`)) continue;
      attempts.push({ benchmarkCase, repetition });
    }
  }

  const total = selected.length * run.config.repetitions;
  const skipped = total - attempts.length;

  markRunStarted(db, run.id);
  setCompletedCount(db, run.id, skipped);

  /** The provider's ceiling wins: exceeding it only produces rate limiting. */
  const concurrency = Math.min(run.config.concurrency, options.adapter.maxConcurrency);
  const limiter = createLimiter(concurrency);
  let completed = skipped;
  let cancelled = false;

  const tasks = attempts.map((attempt) =>
    limiter(async () => {
      if (signal.aborted || cancelled) return;

      try {
        const result = await executePrediction(attempt.benchmarkCase, attempt.repetition, {
          runId: run.id,
          adapter: options.adapter,
          promptContent: options.prompt.content,
          strategy: run.config.contextStrategy,
          mode: run.config.predictionMode,
          pricing: options.modelConfig.pricing,
          model: options.modelConfig.model,
          settings: options.modelConfig.settings,
          maxAttempts: run.config.maxAttempts,
          timeoutMs: run.config.timeoutMs,
          signal,
          seed: run.config.seed,
        });

        recordPrediction(db, result);
        incrementCompleted(db, run.id);
        completed += 1;

        options.onProgress?.({
          completed,
          total,
          caseId: attempt.benchmarkCase.id,
          repetition: attempt.repetition,
          verdict: result.predictedVerdict,
          errorKind: result.error?.kind ?? null,
        });
      } catch (error) {
        if (error instanceof CancelledError) {
          cancelled = true;
          return;
        }
        throw error;
      }
    }),
  );

  try {
    await Promise.all(tasks);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markRunFinished(db, run.id, 'FAILED', message);
    return {
      status: 'FAILED',
      metrics: null,
      executed: completed - skipped,
      skipped,
      wallClockMs: Date.now() - startedAt,
    };
  }

  /**
   * Metrics are computed over everything on disk, including work resumed
   * from a previous attempt at this run — so the wall-clock denominator has
   * to match: the previously accumulated time plus this session's, not just
   * this session's. Using only this session's elapsed time here would let a
   * resumed run's throughput look arbitrarily higher the more work had
   * already been done before the resume.
   */
  const sessionWallClockMs = Date.now() - startedAt;
  const previousWallClockMs = getRunWallClock(db, run.id) ?? 0;
  const wallClockMs = previousWallClockMs + sessionWallClockMs;

  const metrics = aggregateRunMetrics(buildEvaluatedPredictions(db, run.id), {
    predictionMode: run.config.predictionMode,
    seed: run.config.seed,
    wallClockMs,
  });

  saveRunMetrics(db, run.id, metrics, wallClockMs);

  const status = cancelled || signal.aborted ? 'CANCELLED' : 'COMPLETED';
  markRunFinished(db, run.id, status);

  return {
    status,
    metrics,
    executed: completed - skipped,
    skipped,
    wallClockMs,
  };
};
