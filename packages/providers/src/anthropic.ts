import { InfrastructureError } from '@tob/core';
import { asRecord, numberAt, postJson, requireApiKey } from './http';
import { postSse } from './sse';
import type { AdapterContext, ModelAdapter, ModelRequest, ModelResponse } from './types';
import type { TokenUsage } from '@tob/core';

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

const buildBody = (request: ModelRequest, stream: boolean): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model: request.model,
    system: request.system,
    messages: [{ role: 'user', content: request.user }],
    /** Anthropic requires an explicit ceiling, so fall back rather than omit. */
    max_tokens: request.settings.maxOutputTokens ?? 2048,
    stream,
  };

  if (request.settings.temperature !== null) body['temperature'] = request.settings.temperature;
  if (request.settings.topP !== null) body['top_p'] = request.settings.topP;

  if (request.settings.reasoningEffort !== null && request.settings.reasoningEffort !== 'none') {
    const budgets = { low: 1024, medium: 4096, high: 16384 } as const;
    const budget = budgets[request.settings.reasoningEffort];
    body['thinking'] = { type: 'enabled', budget_tokens: budget };
    /** Extended thinking needs headroom above the thinking budget itself. */
    body['max_tokens'] = Math.max(Number(body['max_tokens']), budget + 1024);
  }

  return body;
};

const usageFrom = (raw: unknown, previous: TokenUsage): TokenUsage => {
  const usage = asRecord(raw);
  const inputTokens = numberAt(usage, 'input_tokens') || previous.inputTokens;
  const outputTokens = numberAt(usage, 'output_tokens') || previous.outputTokens;
  const cachedTokens = numberAt(usage, 'cache_read_input_tokens') || previous.cachedTokens;

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens: previous.reasoningTokens,
    totalTokens: inputTokens + outputTokens,
  };
};

const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});

export const createAnthropicAdapter = (context: AdapterContext): ModelAdapter => ({
  provider: 'anthropic',
  maxConcurrency: 4,

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const apiKey = requireApiKey(context.apiKeyEnvVar, context.readEnv, 'anthropic');
    const url = `${(context.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/messages`;
    const headers = { 'x-api-key': apiKey, 'anthropic-version': API_VERSION };
    const requestStartedAt = Date.now();

    if (!request.settings.stream) {
      const payload = await postJson({
        url,
        headers,
        body: buildBody(request, false),
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      });

      const record = asRecord(payload);
      const content = record['content'];
      const text = Array.isArray(content)
        ? content
            .map((block) => asRecord(block))
            .filter((block) => block['type'] === 'text')
            .map((block) => (typeof block['text'] === 'string' ? block['text'] : ''))
            .join('')
        : '';

      return {
        text,
        usage: usageFrom(record['usage'], emptyUsage()),
        timing: { requestStartedAt, firstTokenAt: null, finalTokenAt: Date.now() },
      };
    }

    let firstTokenAt: number | null = null;
    let text = '';
    let usage = emptyUsage();

    await postSse(
      {
        url,
        headers,
        body: buildBody(request, true),
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      },
      ({ data }) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }

        const record = asRecord(parsed);
        const type = record['type'];

        if (type === 'message_start') {
          usage = usageFrom(asRecord(record['message'])['usage'], usage);
          return;
        }

        if (type === 'message_delta') {
          usage = usageFrom(record['usage'], usage);
          return;
        }

        if (type === 'content_block_delta') {
          const delta = asRecord(record['delta']);
          if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            firstTokenAt ??= Date.now();
            text += delta['text'];
          }
        }
      },
    );

    if (text.length === 0) {
      throw new InfrastructureError('Stream produced no text content', { code: 'EMPTY_STREAM' });
    }

    return {
      text,
      usage,
      timing: { requestStartedAt, firstTokenAt, finalTokenAt: Date.now() },
    };
  },
});
