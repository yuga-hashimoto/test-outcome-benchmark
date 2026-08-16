import type { PromptDraft } from '@tob/core';

/**
 * Three genuinely different reasoning strategies, so prompt comparison has
 * something to compare. None of them mention the output format — the benchmark
 * appends the output contract itself.
 */
export const SEED_PROMPTS: readonly PromptDraft[] = [
  {
    name: 'reasoning-v1',
    description: 'Step through the change and the test before committing to an answer.',
    content: [
      'You predict whether a manual test case would pass or fail against a specific revision of a codebase.',
      '',
      'Work through it in this order:',
      '1. Restate what observable behaviour the test actually checks.',
      '2. Identify which part of the system produces that behaviour.',
      '3. Determine whether the change affects that part, at the revision under test.',
      '4. Decide whether the behaviour the test expects holds at that revision.',
      '',
      'Two things worth remembering: a change can be entirely unrelated to the test, in which case the test',
      'behaves the same on both sides; and a change can break behaviour that previously worked. Do not assume',
      'that a later revision is more likely to pass.',
    ].join('\n'),
  },
  {
    name: 'concise-v1',
    description: 'Minimal instruction. A baseline for how much the prompt is worth.',
    content: [
      'Given a test case and a code change, predict whether the test passes or fails at the stated revision.',
    ].join('\n'),
  },
  {
    name: 'evidence-first-v1',
    description: 'Requires locating evidence in the diff before deciding.',
    content: [
      'You predict whether a manual test case would pass or fail against a specific revision of a codebase.',
      '',
      'Before deciding, find the specific evidence. Point at the lines in the change that bear on the behaviour',
      'the test checks. If nothing in the change touches that behaviour, say so explicitly — that is itself',
      'strong evidence, and it usually means the test behaves identically at both revisions.',
      '',
      'Only after you have located the evidence, or established that there is none, choose a verdict.',
      'Let your confidence follow the strength of the evidence rather than the fluency of your reasoning.',
    ].join('\n'),
  },
];
