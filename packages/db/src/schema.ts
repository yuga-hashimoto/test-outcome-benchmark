import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  CaseMetadata,
  Evidence,
  InferenceSettings,
  LatencyMeasurement,
  ModelPricing,
  PredictionErrorRecord,
  PullRequestContext,
  RunConfiguration,
  RunSnapshot,
  TestCaseSpec,
  TokenUsage,
} from '@tob/core';
import type { RunMetrics } from '@tob/core';

/**
 * Nested value objects are stored as JSON and typed at the column, so the
 * shapes in the database are the shapes in `@tob/core` rather than a parallel
 * set of flattened columns that can drift from them.
 *
 * Fields that runs are filtered, grouped or sliced by are promoted to real
 * columns so those queries stay indexable.
 */

export const datasets = sqliteTable('datasets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: text('created_at').notNull(),
});

export const datasetVersions = sqliteTable(
  'dataset_versions',
  {
    id: text('id').primaryKey(),
    datasetId: text('dataset_id')
      .notNull()
      .references(() => datasets.id),
    version: integer('version').notNull(),
    caseCount: integer('case_count').notNull(),
    contentHash: text('content_hash').notNull(),
    frozenAt: text('frozen_at').notNull(),
    notes: text('notes').notNull().default(''),
  },
  (table) => [uniqueIndex('dataset_versions_unique').on(table.datasetId, table.version)],
);

export const cases = sqliteTable(
  'cases',
  {
    id: text('id').primaryKey(),
    datasetVersionId: text('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id),
    caseId: text('case_id').notNull(),
    revision: text('revision').notNull().$type<'base' | 'head'>(),
    flipPairId: text('flip_pair_id'),
    split: text('split').notNull().default('test'),
    /** Never sent to a model. Stripped by `toModelFacingCase` at the seam. */
    goldResult: text('gold_result').notNull().$type<'PASS' | 'FAIL'>(),
    repository: text('repository').notNull(),
    prNumber: integer('pr_number').notNull(),
    testType: text('test_type').notNull(),
    casePattern: text('case_pattern').notNull(),
    pr: text('pr', { mode: 'json' }).notNull().$type<PullRequestContext>(),
    testCase: text('test_case', { mode: 'json' }).notNull().$type<TestCaseSpec>(),
    metadata: text('metadata', { mode: 'json' }).notNull().$type<CaseMetadata>(),
  },
  (table) => [
    uniqueIndex('cases_version_case_unique').on(table.datasetVersionId, table.caseId),
    index('cases_flip_pair').on(table.flipPairId),
    index('cases_repository').on(table.repository),
  ],
);

export const prompts = sqliteTable(
  'prompts',
  {
    id: text('id').primaryKey(),
    /** Groups the versions of one prompt as it is edited or cloned. */
    familyId: text('family_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    content: text('content').notNull(),
    version: integer('version').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('prompts_family_version_unique').on(table.familyId, table.version),
    index('prompts_hash').on(table.contentHash),
  ],
);

export const modelConfigs = sqliteTable('model_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  settings: text('settings', { mode: 'json' }).notNull().$type<InferenceSettings>(),
  baseUrl: text('base_url'),
  /** The name of the variable holding the key, never the key. */
  apiKeyEnvVar: text('api_key_env_var'),
  pricing: text('pricing', { mode: 'json' }).$type<ModelPricing | null>(),
  createdAt: text('created_at').notNull(),
});

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    datasetVersionId: text('dataset_version_id')
      .notNull()
      .references(() => datasetVersions.id),
    modelConfigId: text('model_config_id')
      .notNull()
      .references(() => modelConfigs.id),
    promptId: text('prompt_id')
      .notNull()
      .references(() => prompts.id),
    contextStrategy: text('context_strategy').notNull(),
    config: text('config', { mode: 'json' }).notNull().$type<RunConfiguration>(),
    /** Copied at start time so later edits cannot rewrite what a run meant. */
    snapshot: text('snapshot', { mode: 'json' }).notNull().$type<RunSnapshot>(),
    totalPredictions: integer('total_predictions').notNull().default(0),
    completedPredictions: integer('completed_predictions').notNull().default(0),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    error: text('error'),
  },
  (table) => [
    index('runs_status').on(table.status),
    index('runs_model_prompt').on(table.modelConfigId, table.promptId),
  ],
);

export const predictions = sqliteTable(
  'predictions',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    caseId: text('case_id').notNull(),
    repetition: integer('repetition').notNull(),
    goldVerdict: text('gold_verdict').notNull().$type<'PASS' | 'FAIL'>(),
    predictedVerdict: text('predicted_verdict').$type<'PASS' | 'FAIL' | 'UNKNOWN' | null>(),
    confidence: real('confidence'),
    reason: text('reason'),
    evidence: text('evidence', { mode: 'json' }).notNull().$type<Evidence[]>(),
    requiresRuntimeInformation: integer('requires_runtime_information', { mode: 'boolean' }),
    rawResponse: text('raw_response').notNull().default(''),
    usage: text('usage', { mode: 'json' }).notNull().$type<TokenUsage>(),
    latency: text('latency', { mode: 'json' }).$type<LatencyMeasurement | null>(),
    costUsd: real('cost_usd'),
    error: text('error', { mode: 'json' }).$type<PredictionErrorRecord | null>(),
    warnings: text('warnings', { mode: 'json' }).notNull().$type<string[]>(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    /** Makes a resumed run idempotent: a completed attempt is never redone. */
    uniqueIndex('predictions_attempt_unique').on(table.runId, table.caseId, table.repetition),
    index('predictions_run').on(table.runId),
  ],
);

export const runMetrics = sqliteTable('run_metrics', {
  runId: text('run_id')
    .primaryKey()
    .references(() => runs.id),
  metrics: text('metrics', { mode: 'json' }).notNull().$type<RunMetrics>(),
  wallClockMs: integer('wall_clock_ms'),
  computedAt: text('computed_at').notNull(),
});

export const humanSessions = sqliteTable('human_sessions', {
  id: text('id').primaryKey(),
  datasetVersionId: text('dataset_version_id')
    .notNull()
    .references(() => datasetVersions.id),
  participantLabel: text('participant_label').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
});

export const humanResponses = sqliteTable(
  'human_responses',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => humanSessions.id),
    participantLabel: text('participant_label').notNull(),
    caseId: text('case_id').notNull(),
    contextStrategy: text('context_strategy').notNull(),
    verdict: text('verdict').notNull().$type<'PASS' | 'FAIL'>(),
    confidence: real('confidence'),
    timeSpentMs: integer('time_spent_ms').notNull(),
    notes: text('notes').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('human_responses_unique').on(table.sessionId, table.caseId)],
);

export const schema = {
  datasets,
  datasetVersions,
  cases,
  prompts,
  modelConfigs,
  runs,
  predictions,
  runMetrics,
  humanSessions,
  humanResponses,
};
