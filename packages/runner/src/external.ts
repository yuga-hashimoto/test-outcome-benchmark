import {
  aggregateRunMetrics,
  clusterIdOf,
  defaultRunConfiguration,
  emptyUsage,
  estimateCost,
  isPredictedVerdict,
  renderPrompt,
  toModelFacingCase,
} from '@tob/core';
import {
  buildEvaluatedPredictions,
  createRun,
  getModelConfig,
  getPrompt,
  getRun,
  getVersion,
  listCases,
  markRunFinished,
  markRunStarted,
  recordPrediction,
  saveRunMetrics,
  setCompletedCount,
} from '@tob/db';
import type {
  BenchmarkCase,
  BenchmarkRun,
  ContextStrategy,
  Evidence,
  ModelFacingCase,
  PredictionMode,
  RunMetrics,
  RunSnapshot,
  Split,
  TokenUsage,
} from '@tob/core';
import type { Db } from '@tob/db';

/**
 * The model-facing view of one case, exactly as an adapter would receive it.
 * Exported so a harness outside this process can put the same question to a
 * model the built-in adapters cannot reach.
 */
export interface ExportedCase {
  readonly caseId: string;
  readonly repetition: number;
  readonly system: string;
  readonly user: string;
  readonly inputHash: string;
}

export interface ExportOptions {
  readonly datasetVersionId: string;
  readonly promptId: string;
  readonly contextStrategy?: ContextStrategy;
  readonly predictionMode?: PredictionMode;
  readonly repetitions?: number;
  readonly split?: Split | null;
}

/**
 * Renders every case through the same path a real run uses, so an imported run
 * answers the identical question. `toModelFacingCase` still strips the gold
 * verdict, so an export can be handed to an external harness without leaking
 * the answers.
 */
export const exportCases = (db: Db, options: ExportOptions): ExportedCase[] => {
  const prompt = getPrompt(db, options.promptId);
  if (prompt === null) throw new Error(`Unknown prompt ${options.promptId}`);

  const cases = listCases(db, options.datasetVersionId, options.split ?? null);
  const repetitions = options.repetitions ?? 1;
  const exported: ExportedCase[] = [];

  for (const benchmarkCase of cases) {
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const rendered = renderPrompt(toModelFacingCase(benchmarkCase) as ModelFacingCase, {
        promptContent: prompt.content,
        strategy: options.contextStrategy ?? 'TEST_PLUS_TITLE_DESCRIPTION_DIFF',
        mode: options.predictionMode ?? 'FORCED',
      });

      exported.push({
        caseId: benchmarkCase.id,
        repetition,
        system: rendered.system,
        user: rendered.user,
        inputHash: rendered.inputHash,
      });
    }
  }

  return exported;
};

/** One answer produced outside this process. */
export interface ExternalPrediction {
  readonly caseId: string;
  readonly repetition?: number;
  readonly verdict?: string | null;
  readonly confidence?: number | null;
  readonly reason?: string | null;
  readonly evidence?: readonly Evidence[];
  readonly requiresRuntimeInformation?: boolean | null;
  readonly raw?: string;
  readonly latencyMs?: number | null;
  readonly usage?: Partial<TokenUsage>;
  readonly error?: string | null;
}

export interface ImportRunInput {
  readonly datasetVersionId: string;
  readonly modelConfigId: string;
  readonly promptId: string;
  readonly predictions: readonly ExternalPrediction[];
  readonly name?: string;
  readonly contextStrategy?: ContextStrategy;
  readonly predictionMode?: PredictionMode;
  readonly split?: Split | null;
  readonly seed?: number;
  readonly wallClockMs?: number | null;
}

export interface ImportRunResult {
  readonly run: BenchmarkRun;
  readonly metrics: RunMetrics;
  readonly imported: number;
  /** Answers whose case id is not in this dataset version. */
  readonly unmatched: readonly string[];
  /** Cases the harness never answered. */
  readonly missing: number;
}

const usageFrom = (partial: Partial<TokenUsage> | undefined): TokenUsage => {
  const base = emptyUsage();
  if (partial === undefined) return base;
  const inputTokens = partial.inputTokens ?? 0;
  const outputTokens = partial.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cachedTokens: partial.cachedTokens ?? 0,
    reasoningTokens: partial.reasoningTokens ?? 0,
    totalTokens: partial.totalTokens ?? inputTokens + outputTokens,
  };
};

/**
 * Records answers produced elsewhere as a first-class run.
 *
 * Everything downstream — scoring, intervals, leaderboards, comparison — treats
 * it identically to a run this process executed, because the scoring engine
 * only ever sees predictions. What differs is that unanswered cases are
 * reported rather than silently dropped: a harness that skipped the hard cases
 * would otherwise look like one that answered them all correctly.
 */
export const importRun = (db: Db, input: ImportRunInput): ImportRunResult => {
  const version = getVersion(db, input.datasetVersionId);
  if (version === null) throw new Error(`Unknown dataset version ${input.datasetVersionId}`);

  const modelConfig = getModelConfig(db, input.modelConfigId);
  if (modelConfig === null) throw new Error(`Unknown model configuration ${input.modelConfigId}`);

  const prompt = getPrompt(db, input.promptId);
  if (prompt === null) throw new Error(`Unknown prompt ${input.promptId}`);

  const cases = new Map<string, BenchmarkCase>();
  for (const item of listCases(db, input.datasetVersionId, input.split ?? null)) {
    cases.set(item.id, item);
  }

  const repetitions = Math.max(
    1,
    ...input.predictions.map((prediction) => (prediction.repetition ?? 0) + 1),
  );

  const config = defaultRunConfiguration({
    datasetVersionId: input.datasetVersionId,
    modelConfigId: input.modelConfigId,
    promptId: input.promptId,
    contextStrategy: input.contextStrategy ?? 'TEST_PLUS_TITLE_DESCRIPTION_DIFF',
    predictionMode: input.predictionMode ?? 'FORCED',
    repetitions,
    concurrency: 1,
    ...(input.split !== undefined ? { split: input.split } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  });

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
    benchmarkGitSha: null,
  };

  const run = createRun(db, {
    name: input.name ?? `${modelConfig.name} · ${prompt.name} v${prompt.version} · imported`,
    config,
    snapshot,
    totalPredictions: cases.size * repetitions,
  });

  markRunStarted(db, run.id);

  const unmatched: string[] = [];
  const answered = new Set<string>();
  let imported = 0;

  for (const prediction of input.predictions) {
    const benchmarkCase = cases.get(prediction.caseId);
    if (benchmarkCase === undefined) {
      unmatched.push(prediction.caseId);
      continue;
    }

    const repetition = prediction.repetition ?? 0;
    const rawVerdict =
      typeof prediction.verdict === 'string' ? prediction.verdict.trim().toUpperCase() : null;
    const verdict = isPredictedVerdict(rawVerdict) ? rawVerdict : null;

    const confidence =
      typeof prediction.confidence === 'number' &&
      Number.isFinite(prediction.confidence) &&
      prediction.confidence >= 0 &&
      prediction.confidence <= 1
        ? prediction.confidence
        : null;

    const usage = usageFrom(prediction.usage);
    const latencyMs = prediction.latencyMs ?? null;

    recordPrediction(db, {
      runId: run.id,
      caseId: benchmarkCase.id,
      repetition,
      goldVerdict: benchmarkCase.gold.result,
      predictedVerdict: verdict,
      confidence,
      reason: prediction.reason ?? null,
      evidence: prediction.evidence ?? [],
      requiresRuntimeInformation: prediction.requiresRuntimeInformation ?? null,
      rawResponse: prediction.raw ?? '',
      usage,
      latency:
        latencyMs === null
          ? null
          : {
              requestStartedAt: 0,
              firstTokenAt: null,
              finalTokenAt: latencyMs,
              parsedAt: latencyMs,
              ttftMs: null,
              generationMs: null,
              modelLatencyMs: latencyMs,
              endToEndMs: latencyMs,
            },
      costUsd: estimateCost(usage, modelConfig.pricing),
      error:
        verdict === null
          ? {
              kind: 'OUTPUT_CONTRACT',
              code: prediction.error === undefined || prediction.error === null ? 'NO_VERDICT' : 'HARNESS_ERROR',
              message: prediction.error ?? 'The harness produced no usable verdict',
              attempts: 1,
            }
          : null,
      warnings: confidence === null && verdict !== null ? ['CONFIDENCE_MISSING'] : [],
    });

    answered.add(`${benchmarkCase.id}::${repetition}`);
    imported += 1;
  }

  setCompletedCount(db, run.id, imported);

  const metrics = aggregateRunMetrics(buildEvaluatedPredictions(db, run.id), {
    seed: config.seed,
    wallClockMs: input.wallClockMs ?? null,
  });

  saveRunMetrics(db, run.id, metrics, input.wallClockMs ?? null);
  markRunFinished(db, run.id, 'COMPLETED');

  return {
    run: getRun(db, run.id) ?? run,
    metrics,
    imported,
    unmatched,
    missing: cases.size * repetitions - answered.size,
  };
};

/** Convenience for callers that only have the case, not the database. */
export const clusterOf = (benchmarkCase: BenchmarkCase): string => clusterIdOf(benchmarkCase);
