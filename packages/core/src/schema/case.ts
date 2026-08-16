import { z } from 'zod';
import { CASE_PATTERNS, QUALITATIVE_LEVELS, REVISIONS, TEST_TYPES } from '../domain/case';
import { VERDICTS } from '../domain/verdict';
import type { BenchmarkCase } from '../domain/case';

const shaSchema = z.string().regex(/^[0-9a-f]{7,40}$/i, 'expected a git object id');

export const pullRequestContextSchema = z.object({
  repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'expected owner/repo'),
  number: z.number().int().positive(),
  baseSha: shaSchema,
  headSha: shaSchema,
  title: z.string().min(1),
  description: z.string(),
  diff: z.string().min(1),
  changedFiles: z.number().int().nonnegative().nullable().default(null),
  addedLines: z.number().int().nonnegative().nullable().default(null),
  deletedLines: z.number().int().nonnegative().nullable().default(null),
  commits: z.number().int().nonnegative().nullable().default(null),
  language: z.string().nullable().default(null),
  labels: z.array(z.string()).default([]),
});

export const testCaseSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  preconditions: z.string(),
  steps: z.array(z.string().min(1)).min(1),
  expectedResult: z.string().min(1),
});

export const caseProvenanceSchema = z.object({
  prUrl: z.string().url(),
  issueUrl: z.string().url().nullable().default(null),
  evidenceTestFile: z.string().nullable().default(null),
  note: z.string().default(''),
});

export const caseMetadataSchema = z.object({
  executedAt: z.string().min(1),
  testType: z.enum(TEST_TYPES),
  tags: z.array(z.string()).default([]),
  durationMs: z.number().nonnegative().nullable().default(null),
  feature: z.string().nullable().default(null),
  platform: z.string().nullable().default(null),
  specificity: z.enum(QUALITATIVE_LEVELS).default('MEDIUM'),
  ambiguity: z.enum(QUALITATIVE_LEVELS).default('MEDIUM'),
  externalDependency: z.boolean().default(false),
  casePattern: z.enum(CASE_PATTERNS),
  provenance: caseProvenanceSchema,
});

export const benchmarkCaseSchema = z.object({
  id: z.string().min(1),
  revision: z.enum(REVISIONS),
  flipPairId: z.string().min(1).nullable().default(null),
  pr: pullRequestContextSchema,
  testCase: testCaseSpecSchema,
  gold: z.object({ result: z.enum(VERDICTS) }),
  metadata: caseMetadataSchema,
});

export const benchmarkCaseArraySchema = z.array(benchmarkCaseSchema).min(1);

export const parseBenchmarkCases = (value: unknown): BenchmarkCase[] =>
  benchmarkCaseArraySchema.parse(value) as BenchmarkCase[];
