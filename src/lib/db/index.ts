// Public surface of the data layer. Callers never see the driver or SQL dialect.
export { openDb, getDb, closeDb, type Db } from './client';
export { runMigrations } from './migrate';
export * from './jobs-repo';
