import { resolvedPredictions } from './confusion';
import type { EvaluatedPrediction, TokenUsage } from '../domain/prediction';
import type { ModelPricing } from '../domain/model';

export interface TokenTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
}

export interface CostMetrics {
  readonly totalUsd: number | null;
  readonly costPerTest: number | null;
  readonly costPer1000Tests: number | null;
  /** Correct predictions per dollar — the efficiency number for the Pareto view. */
  readonly correctPerDollar: number | null;
  readonly tokens: TokenTotals;
  readonly pricedPredictions: number;
  readonly unpricedPredictions: number;
}

const PER_MILLION = 1_000_000;

/**
 * Cached input tokens are treated as a discounted subset of `inputTokens`.
 *
 * Reasoning tokens are only charged separately when the pricing snapshot gives
 * a reasoning rate; otherwise they are assumed to be already counted in
 * `outputTokens`, which is how most providers report them. Charging both ways
 * would silently double-bill reasoning models.
 */
export const estimateCost = (usage: TokenUsage, pricing: ModelPricing | null): number | null => {
  if (pricing === null) return null;

  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  const uncachedInput = usage.inputTokens - cached;
  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;

  const inputCost =
    (uncachedInput * pricing.inputPerMillion + cached * cachedRate) / PER_MILLION;
  const outputCost = (usage.outputTokens * pricing.outputPerMillion) / PER_MILLION;
  const reasoningCost =
    pricing.reasoningPerMillion === null
      ? 0
      : (usage.reasoningTokens * pricing.reasoningPerMillion) / PER_MILLION;

  return inputCost + outputCost + reasoningCost;
};

const emptyTotals = (): TokenTotals => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});

export const computeCostMetrics = (predictions: readonly EvaluatedPrediction[]): CostMetrics => {
  let totalUsd = 0;
  let pricedPredictions = 0;
  let unpricedPredictions = 0;
  const tokens = { ...emptyTotals() };

  for (const prediction of predictions) {
    if (prediction.usage !== null) {
      tokens.inputTokens += prediction.usage.inputTokens;
      tokens.outputTokens += prediction.usage.outputTokens;
      tokens.cachedTokens += prediction.usage.cachedTokens;
      tokens.reasoningTokens += prediction.usage.reasoningTokens;
      tokens.totalTokens += prediction.usage.totalTokens;
    }
    if (prediction.costUsd === null) {
      unpricedPredictions += 1;
    } else {
      totalUsd += prediction.costUsd;
      pricedPredictions += 1;
    }
  }

  if (pricedPredictions === 0) {
    return {
      totalUsd: null,
      costPerTest: null,
      costPer1000Tests: null,
      correctPerDollar: null,
      tokens,
      pricedPredictions,
      unpricedPredictions,
    };
  }

  const correct = resolvedPredictions(predictions).filter(
    (prediction) => prediction.predictedVerdict === prediction.goldVerdict,
  ).length;

  const costPerTest = totalUsd / pricedPredictions;

  return {
    totalUsd,
    costPerTest,
    costPer1000Tests: costPerTest * 1000,
    correctPerDollar: totalUsd === 0 ? null : correct / totalUsd,
    tokens,
    pricedPredictions,
    unpricedPredictions,
  };
};
