import { asRecord, numberAt, postJson, requireApiKey } from './http';
import type { AdapterContext, ModelAdapter, ModelRequest, ModelResponse } from './types';
import type { TokenUsage } from '@tob/core';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const usageFrom = (raw: unknown): TokenUsage => {
  const usage = asRecord(raw);
  const inputTokens = numberAt(usage, 'promptTokenCount');
  const outputTokens = numberAt(usage, 'candidatesTokenCount');

  return {
    inputTokens,
    outputTokens,
    cachedTokens: numberAt(usage, 'cachedContentTokenCount'),
    reasoningTokens: numberAt(usage, 'thoughtsTokenCount'),
    totalTokens: numberAt(usage, 'totalTokenCount') || inputTokens + outputTokens,
  };
};

/**
 * Gemini's generateContent endpoint, non-streaming.
 *
 * TTFT is therefore always null for this provider. That is reported honestly
 * rather than approximated from total latency — an invented first-token time
 * would make a non-streaming provider look comparable to a streaming one.
 */
export const createGeminiAdapter = (context: AdapterContext): ModelAdapter => ({
  provider: 'gemini',
  maxConcurrency: 4,

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const apiKey = requireApiKey(context.apiKeyEnvVar, context.readEnv, 'gemini');
    const base = (context.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const url = `${base}/models/${encodeURIComponent(request.model)}:generateContent`;
    const requestStartedAt = Date.now();

    const generationConfig: Record<string, unknown> = {};
    if (request.settings.temperature !== null) {
      generationConfig['temperature'] = request.settings.temperature;
    }
    if (request.settings.topP !== null) generationConfig['topP'] = request.settings.topP;
    if (request.settings.maxOutputTokens !== null) {
      generationConfig['maxOutputTokens'] = request.settings.maxOutputTokens;
    }

    const payload = await postJson({
      url,
      headers: { 'x-goog-api-key': apiKey },
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
        generationConfig,
      },
      signal: request.signal,
      timeoutMs: request.timeoutMs,
    });

    const record = asRecord(payload);
    const candidates = record['candidates'];
    const first = Array.isArray(candidates) ? asRecord(candidates[0]) : {};
    const parts = asRecord(first['content'])['parts'];

    const text = Array.isArray(parts)
      ? parts
          .map((part) => asRecord(part)['text'])
          .filter((value): value is string => typeof value === 'string')
          .join('')
      : '';

    return {
      text,
      usage: usageFrom(record['usageMetadata']),
      timing: { requestStartedAt, firstTokenAt: null, finalTokenAt: Date.now() },
    };
  },
});
