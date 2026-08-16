import { createRng, hashString } from '@tob/core';
import type { ModelAdapter, ModelRequest, ModelResponse } from './types';

export interface MockAdapterOptions {
  readonly seed?: string;
  /** How strongly the heuristic leans PASS when the head revision is under test. */
  readonly headBias?: number;
  /** Amplitude of the deterministic noise. Higher means a weaker model. */
  readonly noise?: number;
  /** Share of responses that deliberately violate the output contract. */
  readonly malformedRate?: number;
  /** Share of responses that abstain, exercising selective-prediction paths. */
  readonly abstainRate?: number;
  /** Multiplier on the reported confidence, to make a model over- or under-confident. */
  readonly confidenceScale?: number;
  readonly baseLatencyMs?: number;
  readonly latencyJitterMs?: number;
}

const DEFAULTS = {
  seed: 'mock',
  headBias: 0.28,
  noise: 0.5,
  malformedRate: 0.03,
  abstainRate: 0,
  confidenceScale: 1.6,
  baseLatencyMs: 40,
  latencyJitterMs: 60,
} as const;

/**
 * Demo profiles keyed by model name.
 *
 * These exist so a seeded local run produces a leaderboard with real
 * separation between configurations instead of three identical rows. They are
 * scaffolding for the demo path, not claims about any real model.
 */
export const MOCK_PROFILES: Readonly<Record<string, MockAdapterOptions>> = {
  'mock-lean': { noise: 0.62, malformedRate: 0.05, baseLatencyMs: 25, latencyJitterMs: 35 },
  'mock-thorough': {
    noise: 0.34,
    malformedRate: 0.01,
    confidenceScale: 1.3,
    baseLatencyMs: 90,
    latencyJitterMs: 120,
  },
  'mock-overconfident': {
    noise: 0.55,
    malformedRate: 0.02,
    confidenceScale: 3.2,
    baseLatencyMs: 40,
    latencyJitterMs: 40,
  },
  'mock-cautious': {
    noise: 0.45,
    abstainRate: 0.12,
    malformedRate: 0.01,
    confidenceScale: 1.1,
    baseLatencyMs: 60,
    latencyJitterMs: 60,
  },
};

/**
 * A deterministic stand-in so the whole workflow runs with no API key.
 *
 * It cannot be given a target accuracy, because hitting a target would require
 * knowing the gold verdict — which no adapter is allowed to see. Instead it
 * applies a weak heuristic over the same text a real model receives: it leans
 * PASS when the head revision is under test and FAIL when the base revision is,
 * with seeded noise on top.
 *
 * That is deliberately the naive strategy the dataset's negative controls are
 * built to punish, so a demo run yields an interesting scorecard — respectable
 * headline accuracy, poor flip-pair accuracy — rather than a flat 50% or a
 * meaningless 100%.
 */
export const createMockAdapter = (options: MockAdapterOptions = {}): ModelAdapter => {
  const base = { ...DEFAULTS, ...options };

  return {
    provider: 'mock',
    maxConcurrency: 32,

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const config = { ...base, ...MOCK_PROFILES[request.model] };
      const requestStartedAt = Date.now();
      const rng = createRng(`${config.seed}:${request.model}:${request.requestKey}`);

      const context = request.user;
      const isHead = /Revision under test\n+head\b/i.test(context);
      const isBase = /Revision under test\n+base\b/i.test(context);
      const hasDiff = context.includes('```diff');

      let passScore = 0.5;
      if (isHead) passScore += config.headBias;
      if (isBase) passScore -= config.headBias * 0.64;
      if (!hasDiff) passScore += 0.05;

      const noise = (rng.next() - 0.5) * config.noise;
      const finalScore = passScore + noise;

      const abstains = rng.next() < config.abstainRate;
      const malformed = rng.next() < config.malformedRate;

      const verdict = abstains ? 'UNKNOWN' : finalScore >= 0.5 ? 'PASS' : 'FAIL';
      const confidence = Math.min(
        0.99,
        Math.max(0.5, 0.5 + Math.abs(finalScore - 0.5) * config.confidenceScale),
      );

      const text = malformed
        ? 'I believe this test will pass, but I cannot be certain.'
        : JSON.stringify({
            verdict,
            confidence: Number(confidence.toFixed(3)),
            reason: isHead
              ? 'The change appears to address the behaviour the test exercises.'
              : 'The behaviour the test exercises does not appear to be handled at this revision.',
            evidence: hasDiff
              ? [{ file: 'src/changed.ts', location: 'diff', reason: 'Modified by this change.' }]
              : [],
            requiresRuntimeInformation: false,
          });

      const latencyMs = config.baseLatencyMs + Math.floor(rng.next() * config.latencyJitterMs);
      /** Sleep a token amount only, so a full demo run stays fast. */
      await new Promise((resolve) => setTimeout(resolve, Math.min(latencyMs, 3)));

      const finalTokenAt = requestStartedAt + latencyMs;
      /** TTFT only exists when streaming, exactly as with a real provider. */
      const firstTokenAt = request.settings.stream
        ? requestStartedAt + Math.floor(latencyMs * 0.35)
        : null;

      const inputTokens = Math.ceil((request.system.length + request.user.length) / 4);
      const outputTokens = Math.ceil(text.length / 4);

      return {
        text,
        usage: {
          inputTokens,
          outputTokens,
          cachedTokens: 0,
          reasoningTokens: 0,
          totalTokens: inputTokens + outputTokens,
        },
        timing: { requestStartedAt, firstTokenAt, finalTokenAt },
      };
    },
  };
};

/** Exposed so tests can assert the adapter's determinism directly. */
export const mockRequestSeed = (seed: string, model: string, requestKey: string): number =>
  hashString(`${seed}:${model}:${requestKey}`);
