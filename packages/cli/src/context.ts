import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_DATABASE_PATH, openMigratedDatabase } from '@tob/db';
import type { DatabaseHandle } from '@tob/db';

export const resolveDatabasePath = (explicit?: string): string =>
  explicit ?? process.env['TOB_DATABASE'] ?? DEFAULT_DATABASE_PATH;

export const openCliDatabase = (explicit?: string): DatabaseHandle => {
  const path = resolveDatabasePath(explicit);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  return openMigratedDatabase(path);
};

/** Ensures the handle is closed even when a command throws. */
export const withDatabase = async <T>(
  explicit: string | undefined,
  action: (handle: DatabaseHandle) => Promise<T> | T,
): Promise<T> => {
  const handle = openCliDatabase(explicit);
  try {
    return await action(handle);
  } finally {
    handle.close();
  }
};

export const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
