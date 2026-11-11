// Internal to src/lib/db. Nothing outside this directory may import the driver.
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

export type InternalDb = BetterSQLite3Database<typeof schema>;

/** Opaque handle handed to callers; only repository functions can use it. */
export interface Db {
  readonly __brand: 'Db';
}

const handles = new WeakMap<Db, InternalDb>();
const closers = new WeakMap<Db, () => void>();
let shared: Db | undefined;

export function unwrap(db: Db): InternalDb {
  const inner = handles.get(db);
  if (!inner) throw new Error('Invalid database handle');
  return inner;
}

export function openDb(path: string = process.env.DATABASE_PATH ?? './data/instructor.db'): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  const db = {} as Db;
  handles.set(db, drizzle(sqlite, { schema }));
  closers.set(db, () => sqlite.close());
  return db;
}

/** Process-wide handle using DATABASE_PATH. */
export function getDb(): Db {
  shared ??= openDb();
  return shared;
}

export function closeDb(db: Db): void {
  closers.get(db)?.();
  if (db === shared) shared = undefined;
}
