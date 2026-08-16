import { afterEach, describe, expect, it } from 'vitest';
import { InfrastructureError } from '@tob/core';
import { createMockAdapter } from '@tob/providers';
import { executeRun } from '@tob/runner';
import { getRun, getRunMetrics, listPredictions, listWarnings } from '@tob/db';
import { createHarness, defaultCases, makeCase } from './harness';
import type { ModelAdapter, ModelRequest, ModelResponse } from '@tob/providers';
import type { Harness } from './harness';

const open: Harness[] = [];

const harness = (options?: Parameters<typeof createHarness>[0]): Harness => {
  const created = createHarness(options);
  open.push(created);
  return created;
};

afterEach(() => {
  while (open.length > 0) open.pop()?.handle.close();
});

const stubAdapter = (
  complete: (request: ModelRequest) => Promise<ModelResponse>,
  maxConcurrency = 8,
): ModelAdapter => ({ provider: 'mock', maxConcurrency, complete });

const okResponse = (text: string): ModelResponse => ({
  text,
  usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, reasoningTokens: 0, totalTokens: 15 },
  timing: { requestStartedAt: Date.now(), firstTokenAt: null, finalTokenAt: Date.now() },
});

describe('run execution', () => {
  it('produces one prediction per case and repetition and stores metrics', async () => {
    const context = harness({ repetitions: 3 });

    const result = await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: createMockAdapter({ seed: 'test' }),
    });

    expect(result.status).toBe('COMPLETED');
    expect(listPredictions(context.handle.db, context.run.id)).toHaveLength(12);
    expect(getRun(context.handle.db, context.run.id)?.status).toBe('COMPLETED');
    expect(getRunMetrics(context.handle.db, context.run.id)?.counts.attempted).toBe(12);
  });

  it('is reproducible: the same seed produces the same predictions', async () => {
    const verdictsFor = async (): Promise<(string | null)[]> => {
      const context = harness({ repetitions: 2 });
      await executeRun({
        db: context.handle.db,
        run: context.run,
        cases: context.cases,
        prompt: context.prompt,
        modelConfig: context.modelConfig,
        adapter: createMockAdapter({ seed: 'fixed' }),
      });
      return listPredictions(context.handle.db, context.run.id).map(
        (prediction) => prediction.predictedVerdict,
      );
    };

    expect(await verdictsFor()).toEqual(await verdictsFor());
  });

  /** The seam the whole design rests on: gold must not reach the adapter. */
  it('never shows the adapter the gold verdict', async () => {
    const context = harness({ repetitions: 1 });
    const seen: string[] = [];

    await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: stubAdapter(async (request) => {
        seen.push(`${request.system}\n${request.user}`);
        return okResponse('{"verdict":"PASS","confidence":0.6,"reason":"x"}');
      }),
    });

    expect(seen).toHaveLength(4);
    for (const payload of seen) {
      expect(payload).not.toContain('"gold"');
      expect(payload).not.toContain('goldResult');
    }
  });

  it('caps concurrency at the provider ceiling', async () => {
    const context = harness({ repetitions: 4, concurrency: 16 });
    let inFlight = 0;
    let peak = 0;

    await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: stubAdapter(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return okResponse('{"verdict":"PASS","confidence":0.6,"reason":"x"}');
      }, 2),
    });

    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('failure handling', () => {
  it('records a contract violation without retrying it', async () => {
    const context = harness({ repetitions: 1, maxAttempts: 3 });
    let calls = 0;

    await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: stubAdapter(async () => {
        calls += 1;
        return okResponse('I think it passes.');
      }),
    });

    /** One call per case: a malformed answer is a result, not an outage. */
    expect(calls).toBe(4);

    const stored = listPredictions(context.handle.db, context.run.id);
    expect(stored.every((prediction) => prediction.error?.kind === 'OUTPUT_CONTRACT')).toBe(true);
    expect(stored.every((prediction) => prediction.predictedVerdict === null)).toBe(true);

    const metrics = getRunMetrics(context.handle.db, context.run.id);
    expect(metrics?.counts.contractViolations).toBe(4);
    expect(metrics?.counts.resolved).toBe(0);
    expect(metrics?.accuracy).toBeNull();
    expect(metrics?.strictAccuracy).toBe(0);
  });

  it('keeps cost and latency for an unparseable answer', async () => {
    const context = harness({ repetitions: 1 });

    await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: stubAdapter(async () => okResponse('not json')),
    });

    const [stored] = listPredictions(context.handle.db, context.run.id);
    expect(stored?.usage.totalTokens).toBe(15);
    expect(stored?.latency).not.toBeNull();
    expect(stored?.costUsd).not.toBeNull();
  });

  /**
   * A dataset of one case is rejected by the integrity check as single-class,
   * so retry behaviour is exercised on a valid two-class dataset and attempts
   * are counted per case from the request key.
   */
  const twoCases = () => [makeCase('c1', 'PASS'), makeCase('c2', 'FAIL')];

  const callCounter = () => {
    const perCase = new Map<string, number>();
    return {
      perCase,
      record: (requestKey: string): number => {
        const caseId = requestKey.split(':')[0] ?? '';
        const next = (perCase.get(caseId) ?? 0) + 1;
        perCase.set(caseId, next);
        return next;
      },
    };
  };

  it('retries a transient infrastructure failure and succeeds', async () => {
    const context = harness({ repetitions: 1, maxAttempts: 3, cases: twoCases() });
    const counter = callCounter();

    await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: stubAdapter(async (request) => {
        const attempt = counter.record(request.requestKey);
        if (request.requestKey.startsWith('c1') && attempt < 3) {
          throw new InfrastructureError('rate limited', { status: 429 });
        }
        return okResponse('{"verdict":"PASS","confidence":0.9,"reason":"x"}');
      }),
    });

    expect(counter.perCase.get('c1')).toBe(3);
    expect(counter.perCase.get('c2')).toBe(1);

    const stored = listPredictions(context.handle.db, context.run.id).find(
      (prediction) => prediction.caseId === 'c1',
    );
    expect(stored?.error).toBeNull();
    expect(stored?.predictedVerdict).toBe('PASS');
  });

  it('gives up after maxAttempts and records the failure', async () => {
    const context = harness({ repetitions: 1, maxAttempts: 2, cases: twoCases() });
    const counter = callCounter();

    await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: stubAdapter(async (request) => {
        counter.record(request.requestKey);
        throw new InfrastructureError('server error', { status: 503 });
      }),
    });

    expect(counter.perCase.get('c1')).toBe(2);
    expect(counter.perCase.get('c2')).toBe(2);

    const stored = listPredictions(context.handle.db, context.run.id);
    expect(stored.every((prediction) => prediction.error?.kind === 'INFRASTRUCTURE')).toBe(true);
    expect(getRunMetrics(context.handle.db, context.run.id)?.counts.infrastructureErrors).toBe(2);
  });

  it('does not retry an infrastructure error marked non-retryable', async () => {
    const context = harness({ repetitions: 1, maxAttempts: 5, cases: twoCases() });
    const counter = callCounter();

    await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: stubAdapter(async (request) => {
        counter.record(request.requestKey);
        throw new InfrastructureError('bad request', { status: 400, retryable: false });
      }),
    });

    expect(counter.perCase.get('c1')).toBe(1);
    expect(counter.perCase.get('c2')).toBe(1);
  });

  it('records warnings without discarding the verdict', async () => {
    const context = harness({ repetitions: 1 });

    await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: stubAdapter(async () => okResponse('{"verdict":"PASS","reason":"x"}')),
    });

    expect(listWarnings(context.handle.db, context.run.id)['CONFIDENCE_MISSING']).toBe(4);
    expect(getRunMetrics(context.handle.db, context.run.id)?.counts.resolved).toBe(4);
  });
});

describe('resume and cancellation', () => {
  it('preserves completed work when cancelled', async () => {
    const context = harness({ repetitions: 2, concurrency: 1, cases: defaultCases() });
    const controller = new AbortController();
    let calls = 0;

    await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      signal: controller.signal,
      adapter: stubAdapter(async () => {
        calls += 1;
        if (calls === 3) controller.abort();
        return okResponse('{"verdict":"PASS","confidence":0.7,"reason":"x"}');
      }, 1),
    });

    const stored = listPredictions(context.handle.db, context.run.id);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.length).toBeLessThan(8);
    expect(getRun(context.handle.db, context.run.id)?.status).toBe('CANCELLED');
  });

  it('executes only the remaining attempts on a second pass', async () => {
    const context = harness({ repetitions: 2, concurrency: 1 });
    const controller = new AbortController();
    let calls = 0;

    await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      signal: controller.signal,
      adapter: stubAdapter(async () => {
        calls += 1;
        if (calls === 4) controller.abort();
        return okResponse('{"verdict":"PASS","confidence":0.7,"reason":"x"}');
      }, 1),
    });

    const afterFirst = listPredictions(context.handle.db, context.run.id).length;
    expect(afterFirst).toBeLessThan(8);

    let secondPassCalls = 0;
    const result = await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: stubAdapter(async () => {
        secondPassCalls += 1;
        return okResponse('{"verdict":"FAIL","confidence":0.7,"reason":"x"}');
      }),
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.skipped).toBe(afterFirst);
    expect(secondPassCalls).toBe(8 - afterFirst);
    expect(listPredictions(context.handle.db, context.run.id)).toHaveLength(8);
  });

  it('scores a resumed run over everything on disk', async () => {
    const context = harness({ repetitions: 1 });

    await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: stubAdapter(async () => okResponse('{"verdict":"PASS","confidence":0.9,"reason":"x"}')),
    });

    const rerun = await executeRun({
      db: context.handle.db,
      run: context.run,
      cases: context.cases,
      prompt: context.prompt,
      modelConfig: context.modelConfig,
      adapter: stubAdapter(async () => {
        throw new Error('should not be called');
      }),
    });

    expect(rerun.executed).toBe(0);
    expect(rerun.skipped).toBe(4);
    expect(rerun.metrics?.counts.attempted).toBe(4);
  });
});

describe('mock adapter', () => {
  it('is deterministic for a given seed, model and request', async () => {
    const adapter = createMockAdapter({ seed: 's' });
    const request: ModelRequest = {
      model: 'mock-lean',
      system: 'sys',
      user: 'Revision under test\nhead (abc)',
      settings: {
        temperature: 0,
        topP: null,
        maxOutputTokens: 100,
        reasoningEffort: null,
        seed: null,
        stream: false,
      },
      signal: new AbortController().signal,
      timeoutMs: 1000,
      requestKey: 'case:0',
    };

    const first = await adapter.complete(request);
    const second = await adapter.complete(request);
    expect(first.text).toBe(second.text);
  });

  it('reports no time to first token unless the response is streamed', async () => {
    const adapter = createMockAdapter({ seed: 's' });
    const base = {
      model: 'mock-lean',
      system: 'sys',
      user: 'ctx',
      signal: new AbortController().signal,
      timeoutMs: 1000,
      requestKey: 'k',
    };
    const settings = {
      temperature: 0,
      topP: null,
      maxOutputTokens: 100,
      reasoningEffort: null,
      seed: null,
    };

    const unstreamed = await adapter.complete({ ...base, settings: { ...settings, stream: false } });
    const streamed = await adapter.complete({ ...base, settings: { ...settings, stream: true } });

    expect(unstreamed.timing.firstTokenAt).toBeNull();
    expect(streamed.timing.firstTokenAt).not.toBeNull();
  });

  it('produces different behaviour for different mock profiles', async () => {
    const adapter = createMockAdapter({ seed: 'profiles' });
    const request = (model: string): ModelRequest => ({
      model,
      system: 'sys',
      user: 'Revision under test\nbase (abc)\n\n```diff\n-a\n+b\n```',
      settings: {
        temperature: 0,
        topP: null,
        maxOutputTokens: 100,
        reasoningEffort: null,
        seed: null,
        stream: false,
      },
      signal: new AbortController().signal,
      timeoutMs: 1000,
      requestKey: 'case:0',
    });

    const lean = await adapter.complete(request('mock-lean'));
    const thorough = await adapter.complete(request('mock-thorough'));

    expect(lean.text).not.toBe(thorough.text);
  });
});
