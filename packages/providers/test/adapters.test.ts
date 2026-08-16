import { afterEach, describe, expect, it, vi } from 'vitest';
import { InfrastructureError } from '@tob/core';
import {
  createAdapter,
  createAnthropicAdapter,
  createGeminiAdapter,
  createOpenAiAdapter,
  createOpenAiCompatibleAdapter,
  isRetryableStatus,
  postJson,
  requireApiKey,
} from '@tob/providers';
import type { ModelRequest } from '@tob/providers';
import type { InferenceSettings, ModelConfiguration } from '@tob/core';

const settings = (overrides: Partial<InferenceSettings> = {}): InferenceSettings => ({
  temperature: 0,
  topP: null,
  maxOutputTokens: 512,
  reasoningEffort: null,
  seed: null,
  stream: false,
  ...overrides,
});

const request = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
  model: 'test-model',
  system: 'system prompt',
  user: 'user context',
  settings: settings(),
  signal: new AbortController().signal,
  timeoutMs: 5000,
  requestKey: 'case:0',
  ...overrides,
});

const env = (values: Record<string, string>) => (name: string) => values[name];

const context = (overrides: Partial<Parameters<typeof createOpenAiAdapter>[0]> = {}) => ({
  baseUrl: null,
  apiKeyEnvVar: 'TEST_KEY',
  readEnv: env({ TEST_KEY: 'secret-value' }),
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const sseResponse = (events: readonly string[]): Response => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) controller.enqueue(encoder.encode(`${event}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

const stubFetch = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) => {
  const spy = vi.fn(async (input: unknown, init: unknown) =>
    handler(String(input), (init ?? {}) as RequestInit),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
};

const bodyOf = (spy: ReturnType<typeof stubFetch>): Record<string, unknown> =>
  JSON.parse(String((spy.mock.calls[0]?.[1] as RequestInit).body));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transport error mapping', () => {
  it('treats rate limiting and server faults as retryable', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
  });

  /** Retrying a malformed or unauthorised request only spends quota to reach
   * the same answer more slowly. */
  it('treats client mistakes as non-retryable', () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });

  it('raises a retryable error for a 429', async () => {
    stubFetch(() => jsonResponse({ error: 'slow down' }, 429));

    await expect(
      postJson({
        url: 'https://example.test/v1',
        headers: {},
        body: {},
        signal: new AbortController().signal,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ retryable: true, status: 429 });
  });

  it('raises a non-retryable error for a 400', async () => {
    stubFetch(() => jsonResponse({ error: 'bad' }, 400));

    await expect(
      postJson({
        url: 'https://example.test/v1',
        headers: {},
        body: {},
        signal: new AbortController().signal,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ retryable: false, status: 400 });
  });

  it('wraps a network failure as infrastructure', async () => {
    stubFetch(() => {
      throw new TypeError('connection refused');
    });

    await expect(
      postJson({
        url: 'https://example.test/v1',
        headers: {},
        body: {},
        signal: new AbortController().signal,
        timeoutMs: 1000,
      }),
    ).rejects.toBeInstanceOf(InfrastructureError);
  });

  it('rejects a success response whose body is not JSON', async () => {
    stubFetch(() => new Response('<html>oops</html>', { status: 200 }));

    await expect(
      postJson({
        url: 'https://example.test/v1',
        headers: {},
        body: {},
        signal: new AbortController().signal,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: 'MALFORMED_ENVELOPE' });
  });
});

describe('api keys', () => {
  it('reads the key by variable name at call time', () => {
    expect(requireApiKey('TEST_KEY', env({ TEST_KEY: 'abc' }), 'test')).toBe('abc');
  });

  it('fails without retrying when the variable is unset', () => {
    expect(() => requireApiKey('TEST_KEY', env({}), 'test')).toThrowError(/not set/);
    try {
      requireApiKey('TEST_KEY', env({}), 'test');
    } catch (error) {
      expect(error).toBeInstanceOf(InfrastructureError);
      expect((error as InfrastructureError).retryable).toBe(false);
    }
  });

  it('fails when no variable was configured at all', () => {
    expect(() => requireApiKey(null, env({}), 'test')).toThrowError(/environment variable/);
  });
});

describe('openai adapter', () => {
  it('parses content and token usage including cached and reasoning tokens', async () => {
    stubFetch(() =>
      jsonResponse({
        choices: [{ message: { content: '{"verdict":"PASS"}' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 40 },
          completion_tokens_details: { reasoning_tokens: 8 },
        },
      }),
    );

    const response = await createOpenAiAdapter(context()).complete(request());

    expect(response.text).toBe('{"verdict":"PASS"}');
    expect(response.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 40,
      reasoningTokens: 8,
      totalTokens: 120,
    });
    expect(response.timing.firstTokenAt).toBeNull();
  });

  it('sends the key as a bearer token and never in the body', async () => {
    const spy = stubFetch(() => jsonResponse({ choices: [{ message: { content: 'x' } }] }));
    await createOpenAiAdapter(context()).complete(request());

    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer secret-value');
    expect(String(init.body)).not.toContain('secret-value');
  });

  it('accumulates a streamed response and records time to first token', async () => {
    stubFetch(() =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"{\\"verdict\\":"}}]}',
        'data: {"choices":[{"delta":{"content":"\\"FAIL\\"}"}}]}',
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}',
        'data: [DONE]',
      ]),
    );

    const response = await createOpenAiAdapter(context()).complete(
      request({ settings: settings({ stream: true }) }),
    );

    expect(response.text).toBe('{"verdict":"FAIL"}');
    expect(response.usage.inputTokens).toBe(10);
    expect(response.timing.firstTokenAt).not.toBeNull();
  });

  it('requires a base URL for an OpenAI-compatible endpoint', () => {
    expect(() => createOpenAiCompatibleAdapter(context())).toThrowError(/base URL/);
  });

  it('uses the configured base URL when one is given', async () => {
    const spy = stubFetch(() => jsonResponse({ choices: [{ message: { content: 'x' } }] }));
    await createOpenAiCompatibleAdapter(context({ baseUrl: 'https://gateway.test/v1' })).complete(
      request(),
    );

    expect(String(spy.mock.calls[0]?.[0])).toBe('https://gateway.test/v1/chat/completions');
  });
});

describe('anthropic adapter', () => {
  it('joins text blocks and maps usage', async () => {
    stubFetch(() =>
      jsonResponse({
        content: [
          { type: 'text', text: '{"verdict":' },
          { type: 'text', text: '"PASS"}' },
        ],
        usage: { input_tokens: 55, output_tokens: 9, cache_read_input_tokens: 12 },
      }),
    );

    const response = await createAnthropicAdapter(context()).complete(request());

    expect(response.text).toBe('{"verdict":"PASS"}');
    expect(response.usage.inputTokens).toBe(55);
    expect(response.usage.cachedTokens).toBe(12);
    expect(response.usage.totalTokens).toBe(64);
  });

  it('sends the key in the x-api-key header with a version', async () => {
    const spy = stubFetch(() => jsonResponse({ content: [{ type: 'text', text: 'x' }] }));
    await createAnthropicAdapter(context()).complete(request());

    const headers = (spy.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('secret-value');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('reads usage from message_start and message_delta while streaming', async () => {
    stubFetch(() =>
      sseResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":30}}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}',
        'data: {"type":"message_delta","usage":{"output_tokens":7}}',
      ]),
    );

    const response = await createAnthropicAdapter(context()).complete(
      request({ settings: settings({ stream: true }) }),
    );

    expect(response.text).toBe('hello');
    expect(response.usage.inputTokens).toBe(30);
    expect(response.usage.outputTokens).toBe(7);
    expect(response.timing.firstTokenAt).not.toBeNull();
  });

  /** Extended thinking consumes the same budget the answer needs, so the
   * ceiling has to clear the thinking budget or the response is truncated. */
  it('raises max_tokens above the thinking budget when reasoning is enabled', async () => {
    const spy = stubFetch(() => jsonResponse({ content: [{ type: 'text', text: 'x' }] }));
    await createAnthropicAdapter(context()).complete(
      request({ settings: settings({ reasoningEffort: 'high', maxOutputTokens: 512 }) }),
    );

    const body = bodyOf(spy);
    expect(body['thinking']).toEqual({ type: 'enabled', budget_tokens: 16384 });
    expect(Number(body['max_tokens'])).toBeGreaterThan(16384);
  });

  it('does not enable thinking when reasoning effort is none', async () => {
    const spy = stubFetch(() => jsonResponse({ content: [{ type: 'text', text: 'x' }] }));
    await createAnthropicAdapter(context()).complete(
      request({ settings: settings({ reasoningEffort: 'none' }) }),
    );

    expect(bodyOf(spy)['thinking']).toBeUndefined();
  });
});

describe('gemini adapter', () => {
  it('joins candidate parts and maps usage metadata', async () => {
    stubFetch(() =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: '{"verdict":' }, { text: '"FAIL"}' }] } }],
        usageMetadata: {
          promptTokenCount: 80,
          candidatesTokenCount: 12,
          cachedContentTokenCount: 5,
          thoughtsTokenCount: 3,
          totalTokenCount: 92,
        },
      }),
    );

    const response = await createGeminiAdapter(context()).complete(request());

    expect(response.text).toBe('{"verdict":"FAIL"}');
    expect(response.usage.reasoningTokens).toBe(3);
    expect(response.usage.totalTokens).toBe(92);
  });

  /** Non-streaming in V1, so this is reported as unobservable rather than
   * approximated from total latency. */
  it('always reports a null time to first token', async () => {
    stubFetch(() => jsonResponse({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }));

    const response = await createGeminiAdapter(context()).complete(
      request({ settings: settings({ stream: true }) }),
    );

    expect(response.timing.firstTokenAt).toBeNull();
  });
});

describe('adapter registry', () => {
  const config = (overrides: Partial<ModelConfiguration> = {}): ModelConfiguration => ({
    id: 'm1',
    name: 'model',
    provider: 'mock',
    model: 'mock-lean',
    settings: settings(),
    baseUrl: null,
    apiKeyEnvVar: null,
    pricing: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('builds a mock adapter without needing any key', () => {
    expect(createAdapter(config()).provider).toBe('mock');
  });

  it('builds each real provider with its own concurrency ceiling', () => {
    const readEnv = env({ KEY: 'v' });

    expect(
      createAdapter(config({ provider: 'openai', apiKeyEnvVar: 'KEY' }), { readEnv })
        .maxConcurrency,
    ).toBe(8);
    expect(
      createAdapter(config({ provider: 'anthropic', apiKeyEnvVar: 'KEY' }), { readEnv })
        .maxConcurrency,
    ).toBe(4);
    expect(
      createAdapter(config({ provider: 'gemini', apiKeyEnvVar: 'KEY' }), { readEnv })
        .maxConcurrency,
    ).toBe(4);
  });

  it('defers the key lookup until a request is made', () => {
    expect(() =>
      createAdapter(config({ provider: 'openai', apiKeyEnvVar: 'MISSING' }), { readEnv: env({}) }),
    ).not.toThrow();
  });
});
