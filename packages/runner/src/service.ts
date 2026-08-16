import { execFileSync } from 'node:child_process';
import {
  aggregateRunMetrics,
  applyDistribution,
  defaultRunConfiguration,
  pairedClusterBootstrapDelta,
} from '@tob/core';
import {
  buildEvaluatedPredictions,
  createRun,
  getModelConfig,
  getPrompt,
  getRun,
  getRunWallClock,
  getVersion,
  listCases,
  saveRunMetrics,
} from '@tob/db';
import { createAdapter } from '@tob/providers';
import { executeRun } from './run';
import type { ExecuteRunResult, RunProgress } from './run';
import type { Db } from '@tob/db';
import type {
  BenchmarkRun,
  ContextStrategy,
  Distribution,
  PairedComparison,
  PredictionMode,
  RunMetrics,
  RunSnapshot,
  Split,
} from '@tob/core';

/** Recorded in the snapshot so a run can be tied to the code that produced it. */
const currentGitSha = (): string | null => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

export interface StartRunInput {
  readonly datasetVersionId: string;
  readonly modelConfigId: string;
  readonly promptId: string;
  readonly name?: string;
  readonly contextStrategy?: ContextStrategy;
  readonly predictionMode?: PredictionMode;
  readonly repetitions?: number;
  readonly concurrency?: number;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly seed?: number;
  readonly split?: Split | null;
  readonly distribution?: Distribution;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RunProgress) => void;
  readonly readEnv?: (name: string) => string | undefined;
}

export interface StartRunOutput extends ExecuteRunResult {
  readonly run: BenchmarkRun;
}

/**
 * Resolves a run's configuration into a snapshot and executes it.
 *
 * The snapshot copies the dataset hash, the full prompt text and the pricing in
 * force at start time. Editing a prompt or repricing a model afterwards cannot
 * retroactively change what a finished run reported.
 */
export const startRun = async (db: Db, input: StartRunInput): Promise<StartRunOutput> => {
  const version = getVersion(db, input.datasetVersionId);
  if (version === null) throw new Error(`Unknown dataset version ${input.datasetVersionId}`);

  const modelConfig = getModelConfig(db, input.modelConfigId);
  if (modelConfig === null) throw new Error(`Unknown model configuration ${input.modelConfigId}`);

  const prompt = getPrompt(db, input.promptId);
  if (prompt === null) throw new Error(`Unknown prompt ${input.promptId}`);

  const config = defaultRunConfiguration({
    datasetVersionId: input.datasetVersionId,
    modelConfigId: input.modelConfigId,
    promptId: input.promptId,
    ...(input.contextStrategy !== undefined ? { contextStrategy: input.contextStrategy } : {}),
    ...(input.predictionMode !== undefined ? { predictionMode: input.predictionMode } : {}),
    ...(input.repetitions !== undefined ? { repetitions: input.repetitions } : {}),
    ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    ...(input.split !== undefined ? { split: input.split } : {}),
    ...(input.distribution !== undefined ? { distribution: input.distribution } : {}),
  });

  const allCases = listCases(db, input.datasetVersionId, config.split);
  if (allCases.length === 0) throw new Error('Dataset version contains no cases for this split');

  const selected = applyDistribution(allCases, config.distribution, 'plan');

  const snapshot: RunSnapshot = {
    datasetId: version.datasetId,
    datasetName: version.datasetId,
    datasetVersion: version.version,
    datasetContentHash: version.contentHash,
    modelName: modelConfig.name,
    provider: modelConfig.provider,
    model: modelConfig.model,
    settings: modelConfig.settings,
    pricing: modelConfig.pricing,
    promptName: prompt.name,
    promptVersion: prompt.version,
    promptHash: prompt.contentHash,
    promptContent: prompt.content,
    benchmarkGitSha: currentGitSha(),
    harnessConditions: null,
  };

  const run = createRun(db, {
    name:
      input.name ??
      `${modelConfig.name} · ${prompt.name} v${prompt.version} · ${config.contextStrategy}`,
    config,
    snapshot,
    totalPredictions: selected.length * config.repetitions,
  });

  const adapter = createAdapter(modelConfig, {
    ...(input.readEnv !== undefined ? { readEnv: input.readEnv } : {}),
    mockSeed: `run:${config.seed}`,
  });

  const result = await executeRun({
    db,
    run,
    cases: allCases,
    prompt,
    modelConfig,
    adapter,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.onProgress !== undefined ? { onProgress: input.onProgress } : {}),
  });

  return { ...result, run: getRun(db, run.id) ?? run };
};

export interface ResumeRunInput {
  readonly runId: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RunProgress) => void;
  readonly readEnv?: (name: string) => string | undefined;
}

/** Picks up an interrupted run using its stored configuration, not a new one. */
export const resumeRun = async (db: Db, input: ResumeRunInput): Promise<StartRunOutput> => {
  const run = getRun(db, input.runId);
  if (run === null) throw new Error(`Unknown run ${input.runId}`);

  const modelConfig = getModelConfig(db, run.config.modelConfigId);
  if (modelConfig === null) throw new Error(`Unknown model configuration ${run.config.modelConfigId}`);

  const prompt = getPrompt(db, run.config.promptId);
  if (prompt === null) throw new Error(`Unknown prompt ${run.config.promptId}`);

  const adapter = createAdapter(modelConfig, {
    ...(input.readEnv !== undefined ? { readEnv: input.readEnv } : {}),
    mockSeed: `run:${run.config.seed}`,
  });

  const result = await executeRun({
    db,
    run,
    cases: listCases(db, run.config.datasetVersionId, run.config.split),
    prompt,
    modelConfig,
    adapter,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.onProgress !== undefined ? { onProgress: input.onProgress } : {}),
  });

  return { ...result, run: getRun(db, run.id) ?? run };
};

/**
 * Rescores stored predictions, e.g. after a scoring change. No model calls,
 * so no new timing information exists — the previously recorded wall-clock
 * time is carried forward rather than overwritten with null, which would
 * otherwise silently erase every run's throughput the first time its scoring
 * is recomputed.
 */
export const recomputeRunMetrics = (db: Db, runId: string): RunMetrics => {
  const run = getRun(db, runId);
  if (run === null) throw new Error(`Unknown run ${runId}`);

  const wallClockMs = getRunWallClock(db, runId);
  const metrics = aggregateRunMetrics(buildEvaluatedPredictions(db, runId), {
    predictionMode: run.config.predictionMode,
    seed: run.config.seed,
    wallClockMs,
  });
  saveRunMetrics(db, runId, metrics, wallClockMs);
  return metrics;
};

export interface RunComparison extends PairedComparison {
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  readonly sameDatasetVersion: boolean;
}

/**
 * Paired comparison of two runs on the same cases.
 *
 * `sameDatasetVersion` is surfaced rather than enforced: comparing across
 * dataset versions is occasionally what you want, but reading the delta without
 * knowing the case sets differ would be misleading.
 */
export const compareRuns = (
  db: Db,
  baselineRunId: string,
  candidateRunId: string,
): RunComparison => {
  const baseline = getRun(db, baselineRunId);
  const candidate = getRun(db, candidateRunId);
  if (baseline === null) throw new Error(`Unknown run ${baselineRunId}`);
  if (candidate === null) throw new Error(`Unknown run ${candidateRunId}`);

  const comparison = pairedClusterBootstrapDelta(
    buildEvaluatedPredictions(db, baselineRunId),
    buildEvaluatedPredictions(db, candidateRunId),
    { seed: `compare:${baselineRunId}:${candidateRunId}` },
  );

  return {
    ...comparison,
    baselineRunId,
    candidateRunId,
    sameDatasetVersion:
      baseline.config.datasetVersionId === candidate.config.datasetVersionId,
  };
};
