import type { PredictionMode } from '../domain/verdict';

/**
 * The output contract belongs to the benchmark, not to the user's prompt
 * (spec §4). Users control the reasoning instructions freely; this block is
 * always appended so every response stays machine-scoreable.
 */
export const outputContract = (mode: PredictionMode): string => {
  const verdictValues =
    mode === 'SELECTIVE'
      ? '"PASS", "FAIL", or "UNKNOWN" if you genuinely cannot decide'
      : '"PASS" or "FAIL" — you must commit to one';

  return [
    '## Required output format',
    '',
    'Respond with a single JSON object and nothing else. No prose before or after, no markdown fence.',
    '',
    '{',
    `  "verdict": ${verdictValues},`,
    '  "confidence": a number from 0 to 1 expressing how likely your verdict is correct,',
    '  "reason": a short explanation of your reasoning,',
    '  "evidence": an array of {"file": string, "location": string, "reason": string} entries supporting the verdict,',
    '  "requiresRuntimeInformation": true if deciding correctly would need runtime observation you do not have',
    '}',
    '',
    'Do not execute the test, run the application, or assume any runtime observation.',
    'Predict the outcome the test would actually have at the stated revision.',
  ].join('\n');
};
