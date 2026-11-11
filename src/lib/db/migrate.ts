import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql } from 'drizzle-orm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb, unwrap, type Db } from './client';

// Built with path functions (not `new URL('./migrations', import.meta.url)`) so the Next bundler does not try to
// resolve the folder as a module: migrations only ever run from the worker, the CLI and tests.
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Applies pending migrations. Foreign keys are switched off for the duration (SQLite's documented procedure for
 * table rebuilds; the pragma is ignored inside a transaction) and verified afterwards, so a rebuild can never
 * leave dangling references behind.
 */
export function runMigrations(db: Db): void {
  const inner = unwrap(db);
  inner.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    migrate(inner, { migrationsFolder });
    const violations = inner.all(sql`PRAGMA foreign_key_check`);
    if (violations.length > 0) throw new Error(`Migration left ${violations.length} foreign key violation(s)`);
  } finally {
    inner.run(sql`PRAGMA foreign_keys = ON`);
  }
}

// CLI: `npm run db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = getDb();
  runMigrations(db);
  closeDb(db);
  console.log('Migrations applied.');
}
