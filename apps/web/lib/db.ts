import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { openMigratedDatabase } from '@tob/db';
import type { DatabaseHandle } from '@tob/db';

/**
 * Next runs with its own directory as the working directory, so a relative
 * database path would resolve inside `apps/web` rather than at the repository
 * root where the CLI writes it. Anchor to the workspace root instead.
 */
const workspaceRoot = (): string => {
  let current = process.cwd();
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
};

const databasePath = (): string => {
  const configured = process.env['TOB_DATABASE'];
  if (configured !== undefined && isAbsolute(configured)) return configured;
  return resolve(workspaceRoot(), configured ?? 'data/benchmark.sqlite');
};

/**
 * One connection per process, cached across hot reloads in development so a
 * file watcher restart does not leak handles.
 */
const globalForDb = globalThis as unknown as { tobDatabase?: DatabaseHandle };

export const database = (): DatabaseHandle => {
  if (globalForDb.tobDatabase === undefined) {
    globalForDb.tobDatabase = openMigratedDatabase(databasePath());
  }
  return globalForDb.tobDatabase;
};

export const db = () => database().db;
