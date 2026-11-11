import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb, unwrap, type Db } from './client';

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

export function runMigrations(db: Db): void {
  migrate(unwrap(db), { migrationsFolder });
}

// CLI: `npm run db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = getDb();
  runMigrations(db);
  closeDb(db);
  console.log('Migrations applied.');
}
