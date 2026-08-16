import {
  CancelledError,
  OutputContractViolation,
  createRng,
  emptyUsage,
  estimateCost,
  parsePredictionOutput,
  renderPrompt,
  toErrorRecord,
  toModelFacingCase,
} from '@tob/core';
import { withRetry } from './retry';
import type {
  BenchmarkCase,
  LatencyMeasurement,
  ModelPricing,
  PredictionMode,
  ContextStrategy,
} from '@tob/core';
import type { ModelAdapter, ResponseTiming } from '@tob/providers';
import type { RecordPredictionInput } from '@tob/db';

export interface ExecuteOptions {
  readonly runId: string;
  readonly adapter: ModelAdapter;
  readonly promptContent: string;
  readonly strategy: ContextStrategy;
  readonly mode: PredictionMode;
  readonly pricing: ModelPricing | null;
  readonly model: string;
  readonly settings: Parameters<ModelAdapter['complete']>[0]['settings'];
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly seed: number;
}

const buildLatency = (timing: ResponseTiming, parsedAt: number): LatencyMeasurement => ({
  requestStartedAt: timing.requestStartedAt,
  firstTokenAt: timing.firstTokenAt,
  finalTokenAt: timing.finalTokenAt,
  parsedAt,
  ttftMs: timing.firstTokenAt === null ? null : timing.firstTokenAt - timing.requestStartedAt,
  generationMs:
    timing.firstTokenAt === null ? null : timing.finalTokenAt - timing.firstTokenAt,
  modelLatencyMs: timing.finalTokenAt - timing.requestStartedAt,
  endToEndMs: parsedAt - timing.requestStartedAt,
});

/**
 * Runs one attempt end to end and returns a row to persist — including when it
 * fails.
 *
 * A failure is a benchmark observation, not an absence of one. A model that
 * cannot produce parseable output on a case has told us something about that
 * case, and dropping the row would quietly remove the hardest items from the
 * denominator.
 */
export const executePrediction = async (
  benchmarkCase: BenchmarkCase,
  repetition: number,
  options: ExecuteOptions,
): Promise<RecordPredictionInput> => {
  /** The only place model input is produced, and gold is gone before it. */
  const rendered = renderPrompt(toModelFacingCase(benchmarkCase), {
    promptContent: options.promptContent,
    strategy: options.strategy,
    mode: options.mode,
  });

  const base = {
    runId: options.runId,
    caseId: benchmarkCase.id,
    repetition,
    goldVerdict: benchmarkCase.gold.result,
  } as const;

  try {
    const { value: response, attempts } = await withRetry(
      () =>
        options.adapter.complete({
          model: options.model,
          system: rendered.system,
          user: rendered.user,
          settings: options.settings,
          signal: options.signal,
          timeoutMs: options.timeoutMs,
          requestKey: `${benchmarkCase.id}:${repetition}:${rendered.inputHash.slice(0, 16)}`,
        }),
      {
        maxAttempts: options.maxAttempts,
        baseDelayMs: 500,
        maxDelayMs: 15_000,
        signal: options.signal,
        rng: createRng(`retry:${options.seed}:${benchmarkCase.id}:${repetition}`),
      },
    );

    try {
      const { prediction, warnings } = parsePredictionOutput(response.text, options.mode);
      const latency = buildLatency(response.timing, Date.now());

      return {
        ...base,
        predictedVerdict: prediction.verdict,
        confidence: prediction.confidence,
        reason: prediction.reason,
        evidence: prediction.evidence,
        requiresRuntimeInformation: prediction.requiresRuntimeInformation,
        rawResponse: response.text,
        usage: response.usage,
        latency,
        costUsd: estimateCost(response.usage, options.pricing),
        error: null,
        warnings,
      };
    } catch (parseError) {
      if (!(parseError instanceof OutputContractViolation)) throw parseError;

      /** Usage and latency are still real, so cost and speed stay accurate
       * even for an answer that could not be scored. */
      return {
        ...base,
        predictedVerdict: null,
        confidence: null,
        reason: null,
        evidence: [],
        requiresRuntimeInformation: null,
        rawResponse: response.text,
        usage: response.usage,
        latency: buildLatency(response.timing, Date.now()),
        costUsd: estimateCost(response.usage, options.pricing),
        error: toErrorRecord(parseError, attempts),
        warnings: [],
      };
    }
  } catch (error) {
    if (error instanceof CancelledError || options.signal.aborted) throw new CancelledError();

    return {
      ...base,
      predictedVerdict: null,
      confidence: null,
      reason: null,
      evidence: [],
      requiresRuntimeInformation: null,
      rawResponse: '',
      usage: emptyUsage(),
      latency: null,
      costUsd: null,
      error: toErrorRecord(error, options.maxAttempts),
      warnings: [],
    };
  }
};
