import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, closeDb, runMigrations, type Db } from '@/lib/db';
import { DbJobQueue } from '@/lib/jobs';

let dir: string;
let file: string;
let db: Db;
let raw: Database.Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'schema-'));
  file = join(dir, 't.db');
  db = openDb(file);
  runMigrations(db);
  raw = new Database(file);
  raw.pragma('foreign_keys = ON');
});
afterEach(() => {
  raw.close();
  closeDb(db);
  rmSync(dir, { recursive: true, force: true });
});

const insertAnalysis = (o: { provider: string; kind?: string; owner?: string; hash?: string }) => {
  const cols = ['id', 'content_hash', 'pipeline_version', 'provider', 'guide_json', 'schema_version', 'created_at'];
  const vals: unknown[] = [crypto.randomUUID(), o.hash ?? crypto.randomUUID(), 'p1', o.provider, '{}', 1, 1];
  if (o.kind !== undefined) { cols.push('source_kind'); vals.push(o.kind); }
  if (o.owner !== undefined) { cols.push('owner_session_id'); vals.push(o.owner); }
  raw.prepare(`INSERT INTO analyses (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
};

describe('analyses ownership constraint', () => {
  it('allows a real-provider PDF analysis to be global', () => {
    expect(() => insertAnalysis({ provider: 'anthropic', kind: 'pdf' })).not.toThrow();
  });
  it('defaults source_kind to pdf', () => {
    insertAnalysis({ provider: 'anthropic' });
    expect(raw.prepare('SELECT source_kind FROM analyses').get()).toEqual({ source_kind: 'pdf' });
  });
  it('rejects a global (ownerless) mock analysis', () => {
    expect(() => insertAnalysis({ provider: 'mock', kind: 'pdf' })).toThrow(/CHECK/);
    expect(() => insertAnalysis({ provider: 'mock', kind: 'pdf', owner: '' })).toThrow(/CHECK/);
  });
  it('rejects a global (ownerless) photo-set analysis, even for a real provider', () => {
    expect(() => insertAnalysis({ provider: 'anthropic', kind: 'images' })).toThrow(/CHECK/);
  });
  it('allows mock and photo-set analyses when an owner session is set', () => {
    expect(() => insertAnalysis({ provider: 'mock', kind: 'pdf', owner: 's1' })).not.toThrow();
    expect(() => insertAnalysis({ provider: 'anthropic', kind: 'images', owner: 's1' })).not.toThrow();
  });
});

describe('jobs.document_id foreign key', () => {
  it('is enforced by the database and accepts a real document', async () => {
    const q = new DbJobQueue(db, () => 1);
    await expect(q.enqueue({ type: 'x', documentId: 'ghost' })).rejects.toThrow(/FOREIGN KEY/i);
    raw.prepare("INSERT INTO sessions (id, created_at) VALUES ('s', 1)").run();
    raw.prepare("INSERT INTO documents (id, session_id, content_hash, kind, original_path, status, created_at) VALUES ('d','s','h','pdf','p','ready',1)").run();
    const j = await q.enqueue({ type: 'x', documentId: 'd' });
    expect(j.documentId).toBe('d');
    expect((await q.enqueue({ type: 'x' })).documentId).toBeNull();
  });
  it('job_artifacts still reference jobs after the table rebuild', () => {
    const fks = raw.prepare("PRAGMA foreign_key_list('job_artifacts')").all() as { table: string }[];
    expect(fks.map((f) => f.table)).toEqual(['jobs']);
    const jobFks = raw.prepare("PRAGMA foreign_key_list('jobs')").all() as { table: string; from: string }[];
    expect(jobFks).toEqual([expect.objectContaining({ table: 'documents', from: 'document_id' })]);
  });
});

describe('upgrade from the 0000 schema with existing rows', () => {
  it('keeps rows, nulls orphan job document ids, and keeps job_artifacts intact', async () => {
    const { cpSync, readFileSync, writeFileSync } = await import('node:fs');
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    const folder = join(dir, 'm0');
    cpSync(join(process.cwd(), 'src/lib/db/migrations'), folder, { recursive: true });
    const jp = join(folder, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(jp, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 1);
    writeFileSync(jp, JSON.stringify(journal));
    const old = new Database(join(dir, 'old.db'));
    old.pragma('foreign_keys = ON');
    migrate(drizzle(old), { migrationsFolder: folder });
    old.prepare("INSERT INTO jobs (id, document_id, type, status, created_at, updated_at) VALUES ('j1','ghost','x','queued',1,1)").run();
    old.prepare("INSERT INTO job_artifacts (job_id, key, data_json, created_at) VALUES ('j1','k','1',1)").run();
    old.prepare("INSERT INTO analyses (id, content_hash, pipeline_version, provider, guide_json, schema_version, created_at) VALUES ('a1','h','p','anthropic','{}',1,1)").run();
    old.prepare("INSERT INTO sessions (id, created_at) VALUES ('s',1)").run();
    old.prepare("INSERT INTO documents (id, session_id, content_hash, kind, original_path, status, created_at) VALUES ('d','s','h','pdf','p','ready',1)").run();
    old.prepare("INSERT INTO guides (id, document_id, analysis_id, session_id, title, created_at) VALUES ('g','d','a1','s','t',1)").run();
    old.close();

    const db2 = openDb(join(dir, 'old.db'));
    runMigrations(db2);
    const check = new Database(join(dir, 'old.db'));
    expect(check.prepare('SELECT id, document_id FROM jobs').all()).toEqual([{ id: 'j1', document_id: null }]);
    expect(check.prepare('SELECT count(*) AS n FROM job_artifacts').get()).toEqual({ n: 1 });
    expect(check.prepare('SELECT id, source_kind FROM analyses').all()).toEqual([{ id: 'a1', source_kind: 'pdf' }]);
    expect(check.prepare('SELECT analysis_id FROM guides').all()).toEqual([{ analysis_id: 'a1' }]);
    expect(check.pragma('foreign_key_check')).toEqual([]);
    check.close();
    closeDb(db2);
  });
});
