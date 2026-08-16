import { InfrastructureError } from '@tob/core';
import { asRecord, numberAt, postJson, requireApiKey } from './http';
import { postSse } from './sse';
import type { AdapterContext, ModelAdapter, ModelRequest, ModelResponse } from './types';
import type { ProviderId, TokenUsage } from '@tob/core';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const buildBody = (request: ModelRequest, stream: boolean): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    stream,
  };

  if (request.settings.temperature !== null) body['temperature'] = request.settings.temperature;
  if (request.settings.topP !== null) body['top_p'] = request.settings.topP;
  if (request.settings.maxOutputTokens !== null) {
    body['max_completion_tokens'] = request.settings.maxOutputTokens;
  }
  if (request.settings.seed !== null) body['seed'] = request.settings.seed;
  if (request.settings.reasoningEffort !== null) {
    body['reasoning_effort'] = request.settings.reasoningEffort;
  }
  if (stream) body['stream_options'] = { include_usage: true };

  return body;
};

const usageFrom = (raw: unknown): TokenUsage => {
  const usage = asRecord(raw);
  const promptDetails = asRecord(usage['prompt_tokens_details']);
  const completionDetails = asRecord(usage['completion_tokens_details']);

  const inputTokens = numberAt(usage, 'prompt_tokens');
  const outputTokens = numberAt(usage, 'completion_tokens');

  return {
    inputTokens,
    outputTokens,
    cachedTokens: numberAt(promptDetails, 'cached_tokens'),
    reasoningTokens: numberAt(completionDetails, 'reasoning_tokens'),
    totalTokens: numberAt(usage, 'total_tokens') || inputTokens + outputTokens,
  };
};

/**
 * OpenAI's chat-completions shape, shared verbatim by the many
 * OpenAI-compatible gateways. `createOpenAiCompatibleAdapter` is the same code
 * with a required base URL and its own provider id.
 */
const createChatCompletionsAdapter = (
  provider: ProviderId,
  context: AdapterContext,
  defaults: { baseUrl: string; maxConcurrency: number },
): ModelAdapter => ({
  provider,
  maxConcurrency: defaults.maxConcurrency,

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const apiKey = requireApiKey(context.apiKeyEnvVar, context.readEnv, provider);
    const url = `${(context.baseUrl ?? defaults.baseUrl).replace(/\/$/, '')}/chat/completions`;
    const headers = { authorization: `Bearer ${apiKey}` };
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
      const choices = record['choices'];
      const first = Array.isArray(choices) ? asRecord(choices[0]) : {};
      const message = asRecord(first['message']);
      const text = typeof message['content'] === 'string' ? message['content'] : '';

      return {
        text,
        usage: usageFrom(record['usage']),
        timing: { requestStartedAt, firstTokenAt: null, finalTokenAt: Date.now() },
      };
    }

    let firstTokenAt: number | null = null;
    let text = '';
    let usage: TokenUsage | null = null;

    await postSse(
      {
        url,
        headers,
        body: buildBody(request, true),
        signal: request.signal,
        timeoutMs: request.timeoutMs,
      },
      ({ data }) => {
        if (data === '[DONE]') return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }

        const record = asRecord(parsed);
        if (record['usage'] !== undefined && record['usage'] !== null) {
          usage = usageFrom(record['usage']);
        }

        const choices = record['choices'];
        if (!Array.isArray(choices) || choices.length === 0) return;

        const delta = asRecord(asRecord(choices[0])['delta']);
        const content = delta['content'];
        if (typeof content === 'string' && content.length > 0) {
          firstTokenAt ??= Date.now();
          text += content;
        }
      },
    );

    if (text.length === 0 && usage === null) {
      throw new InfrastructureError('Stream produced no content', { code: 'EMPTY_STREAM' });
    }

    return {
      text,
      usage: usage ?? { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0 },
      timing: { requestStartedAt, firstTokenAt, finalTokenAt: Date.now() },
    };
  },
});

export const createOpenAiAdapter = (context: AdapterContext): ModelAdapter =>
  createChatCompletionsAdapter('openai', context, {
    baseUrl: DEFAULT_BASE_URL,
    maxConcurrency: 8,
  });

export const createOpenAiCompatibleAdapter = (context: AdapterContext): ModelAdapter => {
  if (context.baseUrl === null) {
    throw new InfrastructureError('An OpenAI-compatible model configuration requires a base URL', {
      code: 'MISSING_BASE_URL',
      retryable: false,
    });
  }
  return createChatCompletionsAdapter('openai-compatible', context, {
    baseUrl: context.baseUrl,
    maxConcurrency: 4,
  });
};
