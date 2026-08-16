import { describe, expect, it } from 'vitest';
import { CONTEXT_STRATEGIES, buildContext, renderPrompt, toModelFacingCase } from '@tob/core';
import { benchmarkCase } from './helpers';

describe('gold leakage', () => {
  /**
   * The decisive check: two cases that differ only in their gold verdict must
   * render to identical bytes. If they ever differ, the gold label is reachable
   * from model input by some path, whatever that path is.
   */
  it.each(CONTEXT_STRATEGIES)('renders identically regardless of gold for %s', (strategy) => {
    const passing = benchmarkCase({ gold: { result: 'PASS' } });
    const failing = benchmarkCase({ gold: { result: 'FAIL' } });

    const renderedPassing = renderPrompt(toModelFacingCase(passing), {
      promptContent: 'Predict the outcome.',
      strategy,
      mode: 'FORCED',
    });
    const renderedFailing = renderPrompt(toModelFacingCase(failing), {
      promptContent: 'Predict the outcome.',
      strategy,
      mode: 'FORCED',
    });

    expect(renderedPassing.user).toBe(renderedFailing.user);
    expect(renderedPassing.inputHash).toBe(renderedFailing.inputHash);
  });

  it('strips gold at runtime, not only in the type system', () => {
    const fromJson = JSON.parse(JSON.stringify(benchmarkCase()));
    const modelFacing = toModelFacingCase(fromJson);

    expect('gold' in modelFacing).toBe(false);
    expect(JSON.stringify(modelFacing)).not.toContain('"gold"');
  });

  it('does not carry gold through even if a stray key survives a database round trip', () => {
    const contaminated = { ...benchmarkCase(), gold: { result: 'FAIL' as const } };
    const rendered = buildContext(toModelFacingCase(contaminated), 'PR_FULL');

    expect(rendered).not.toContain('"result"');
  });
});

describe('context strategies', () => {
  it('states which revision is under test whenever a change is shown', () => {
    const withChange = CONTEXT_STRATEGIES.filter((strategy) => strategy !== 'TEST_ONLY');

    for (const strategy of withChange) {
      const rendered = buildContext(toModelFacingCase(benchmarkCase()), strategy);
      expect(rendered, strategy).toContain('Revision under test');
    }
  });

  it('omits the test case entirely under PR_ONLY', () => {
    const rendered = buildContext(toModelFacingCase(benchmarkCase()), 'PR_ONLY');

    expect(rendered).not.toContain('Empty range reports zero length');
    expect(rendered).toContain('Diff');
  });

  it('omits the diff entirely under TEST_ONLY', () => {
    const rendered = buildContext(toModelFacingCase(benchmarkCase()), 'TEST_ONLY');

    expect(rendered).not.toContain('Math.max');
    expect(rendered).toContain('Empty range reports zero length');
  });

  it('appends the output contract to the user prompt rather than replacing it', () => {
    const rendered = renderPrompt(toModelFacingCase(benchmarkCase()), {
      promptContent: 'MY CUSTOM REASONING INSTRUCTIONS',
      strategy: 'TEST_PLUS_DIFF',
      mode: 'SELECTIVE',
    });

    expect(rendered.system).toContain('MY CUSTOM REASONING INSTRUCTIONS');
    expect(rendered.system).toContain('Required output format');
    expect(rendered.system).toContain('UNKNOWN');
  });

  it('does not offer UNKNOWN in forced mode', () => {
    const rendered = renderPrompt(toModelFacingCase(benchmarkCase()), {
      promptContent: 'Predict.',
      strategy: 'TEST_ONLY',
      mode: 'FORCED',
    });

    expect(rendered.system).not.toContain('UNKNOWN');
  });
});
