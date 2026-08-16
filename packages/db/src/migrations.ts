/**
 * Migrations are plain SQL applied in order and recorded in
 * `schema_migrations`, so an in-memory database in a test is built by exactly
 * the same path as the file on disk.
 *
 * `packages/db/test/schema-drift.test.ts` queries every table declared in
 * `schema.ts` against a freshly migrated database, which fails loudly if this
 * DDL and the Drizzle definitions ever diverge.
 */
export interface Migration {
  readonly id: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001_initial',
    statements: [
      `CREATE TABLE datasets (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE dataset_versions (
        id TEXT PRIMARY KEY NOT NULL,
        dataset_id TEXT NOT NULL REFERENCES datasets(id),
        version INTEGER NOT NULL,
        case_count INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        frozen_at TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE UNIQUE INDEX dataset_versions_unique ON dataset_versions (dataset_id, version)`,
      `CREATE TABLE cases (
        id TEXT PRIMARY KEY NOT NULL,
        dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id),
        case_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        flip_pair_id TEXT,
        split TEXT NOT NULL DEFAULT 'test',
        gold_result TEXT NOT NULL,
        repository TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        test_type TEXT NOT NULL,
        case_pattern TEXT NOT NULL,
        pr TEXT NOT NULL,
        test_case TEXT NOT NULL,
        metadata TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX cases_version_case_unique ON cases (dataset_version_id, case_id)`,
      `CREATE INDEX cases_flip_pair ON cases (flip_pair_id)`,
      `CREATE INDEX cases_repository ON cases (repository)`,
      `CREATE TABLE prompts (
        id TEXT PRIMARY KEY NOT NULL,
        family_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        version INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX prompts_family_version_unique ON prompts (family_id, version)`,
      `CREATE INDEX prompts_hash ON prompts (content_hash)`,
      `CREATE TABLE model_configs (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        settings TEXT NOT NULL,
        base_url TEXT,
        api_key_env_var TEXT,
        pricing TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE runs (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id),
        model_config_id TEXT NOT NULL REFERENCES model_configs(id),
        prompt_id TEXT NOT NULL REFERENCES prompts(id),
        context_strategy TEXT NOT NULL,
        config TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        total_predictions INTEGER NOT NULL DEFAULT 0,
        completed_predictions INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error TEXT
      )`,
      `CREATE INDEX runs_status ON runs (status)`,
      `CREATE INDEX runs_model_prompt ON runs (model_config_id, prompt_id)`,
      `CREATE TABLE predictions (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(id),
        case_id TEXT NOT NULL,
        repetition INTEGER NOT NULL,
        gold_verdict TEXT NOT NULL,
        predicted_verdict TEXT,
        confidence REAL,
        reason TEXT,
        evidence TEXT NOT NULL,
        requires_runtime_information INTEGER,
        raw_response TEXT NOT NULL DEFAULT '',
        usage TEXT NOT NULL,
        latency TEXT,
        cost_usd REAL,
        error TEXT,
        warnings TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX predictions_attempt_unique ON predictions (run_id, case_id, repetition)`,
      `CREATE INDEX predictions_run ON predictions (run_id)`,
      `CREATE TABLE run_metrics (
        run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id),
        metrics TEXT NOT NULL,
        wall_clock_ms INTEGER,
        computed_at TEXT NOT NULL
      )`,
      `CREATE TABLE human_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        dataset_version_id TEXT NOT NULL REFERENCES dataset_versions(id),
        participant_label TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT
      )`,
      `CREATE TABLE human_responses (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES human_sessions(id),
        participant_label TEXT NOT NULL,
        case_id TEXT NOT NULL,
        context_strategy TEXT NOT NULL,
        verdict TEXT NOT NULL,
        confidence REAL,
        time_spent_ms INTEGER NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX human_responses_unique ON human_responses (session_id, case_id)`,
    ],
  },
];
