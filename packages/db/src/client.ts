import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { MIGRATIONS } from './migrations';
import { schema } from './schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  readonly db: Db;
  readonly sqlite: SqliteDatabase;
  close(): void;
}

export const DEFAULT_DATABASE_PATH = 'data/benchmark.sqlite';

/**
 * `:memory:` is the path tests use, and it goes through exactly the same
 * migration path as a file, so a test database cannot drift from a real one.
 */
export const openDatabase = (path: string = DEFAULT_DATABASE_PATH): DatabaseHandle => {
  const sqlite = new BetterSqlite3(path);

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  /** The runner writes one row per prediction; NORMAL keeps that cheap without
   * risking the durability that matters here. */
  sqlite.pragma('synchronous = NORMAL');

  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
};

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export const migrateDatabase = (handle: DatabaseHandle): MigrationResult => {
  const { sqlite } = handle;

  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )`,
  );

  const existing = new Set(
    sqlite
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row) => (row as { id: string }).id),
  );

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (existing.has(migration.id)) {
      alreadyApplied.push(migration.id);
      continue;
    }

    const runMigration = sqlite.transaction(() => {
      for (const statement of migration.statements) sqlite.exec(statement);
      sqlite
        .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(migration.id, new Date().toISOString());
    });

    runMigration();
    applied.push(migration.id);
  }

  return { applied, alreadyApplied };
};

/** Opens and migrates in one step — what the CLI and the web app both want. */
export const openMigratedDatabase = (path?: string): DatabaseHandle => {
  const handle = openDatabase(path);
  migrateDatabase(handle);
  return handle;
};
