import { createHash } from 'node:crypto';
import type { BenchmarkCase } from '../domain/case';

export const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * Identity of a prompt's text. Two prompts with the same hash are the same
 * prompt regardless of name or version number, which is what makes cross-run
 * prompt comparison trustworthy.
 */
export const hashPromptContent = (content: string): string => sha256(content);

/**
 * Deterministic JSON stringify: keys sorted at every level, so two objects
 * with the same content in different key order hash identically.
 */
const canonicalStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${canonicalStringify(val)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/**
 * Stable identity of a full set of cases, used to freeze a dataset version.
 *
 * Hashes every field of every case — not just the id — because a version's
 * whole purpose is to be an immutable reference. Hashing ids alone would let
 * a case's diff or gold label change silently under an unchanged id, and
 * every run that cited this version's hash would still look reproducible
 * when it no longer was.
 */
export const hashCases = (cases: readonly BenchmarkCase[]): string =>
  sha256(
    [...cases]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(canonicalStringify)
      .join('\n'),
  );
