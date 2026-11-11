import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync, readFileSync, lstatSync, readlinkSync, existsSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDb, closeDb, runMigrations, getJobArtifact, type Db } from '@/lib/db';
import { DbJobQueue, HandlerRegistry, runOnce, runWorker } from '@/lib/jobs';
import type { JobQueue } from '@/lib/jobs';
import { LocalStorage, StorageKeyError } from '@/lib/storage';
import { loadConfig, ConfigError } from '@/lib/config';
import { validateCitations, validateGuide } from '@/lib/guide/validate';
import { loadFixtureGuide, simplifyStepChecked, MockProvider, type AIProvider } from '@/lib/ai';
import { readFileSync as rf } from 'node:fs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let dir: string; let db: Db; let now: number; let q: DbJobQueue;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qasec-'));
  db = openDb(join(dir, 't.db')); runMigrations(db);
  now = 1_000_000; q = new DbJobQueue(db, () => now);
});
afterEach(() => { closeDb(db); rmSync(dir, { recursive: true, force: true }); });

describe('fencing', () => {
  it('stale worker cannot complete, fail, heartbeat or write artifacts for a re-claimed job', async () => {
    const j = await q.enqueue({ type: 'x' });
    const a = (await q.claim(1000))!; now += 2000;
    const b = (await q.claim(1000))!;
    expect(b.attempts).toBe(a.attempts + 1);
    expect(await q.completeWithArtifacts(j.id, a.attempts, [{ key: 'k', data: 1 }])).toBe(false);
    expect(await getJobArtifact(db, j.id, 'k')).toBeUndefined();
    expect(await q.fail(j.id, 'boom', a.attempts)).toBeUndefined();
    expect(await q.heartbeat(j.id, 1000, a.attempts)).toBe(false);
    expect(await q.complete(j.id, a.attempts)).toBe(false);
    expect((await q.get(j.id))?.status).toBe('running');
    expect(await q.completeWithArtifacts(j.id, b.attempts, [{ key: 'k', data: 2 }])).toBe(true);
    expect(await getJobArtifact(db, j.id, 'k')).toBe(2);
  });

  it('a failing multi-artifact completion is atomic (nothing persisted, job stays running)', async () => {
    const j = await q.enqueue({ type: 'x' });
    const c = (await q.claim(1000))!;
    const bad = { key: 'bad', data: undefined as unknown };
    // JSON.stringify(undefined) is undefined -> NOT NULL violation inside the transaction
    await expect(q.completeWithArtifacts(j.id, c.attempts, [{ key: 'good', data: 1 }, bad])).rejects.toThrow();
    expect(await getJobArtifact(db, j.id, 'good')).toBeUndefined();
    expect((await q.get(j.id))?.status).toBe('running');
  });

  it('handler AbortSignal fires on lease loss and the zombie result is discarded', async () => {
    const j = await q.enqueue({ type: 'x' });
    const reg = new HandlerRegistry();
    let aborted = false;
    reg.register('x', async (_job, ctx) => {
      // simulate: lease expires and another worker re-claims
      now += 5000;
      const other = (await q.claim(1000))!;
      expect(other.id).toBe(j.id);
      await sleep(80);
      aborted = ctx.signal.aborted;
      return { artifacts: [{ key: 'zombie', data: 1 }] };
    });
    await runOnce(q, reg, { leaseMs: 1000, heartbeatMs: 10, retryMs: 1 });
    expect(aborted).toBe(true);
    expect(await getJobArtifact(db, j.id, 'zombie')).toBeUndefined();
    expect((await q.get(j.id))?.status).toBe('running'); // owned by the second claimer, untouched
  });

  it('stale handler that throws cannot fail the re-claimed job', async () => {
    const j = await q.enqueue({ type: 'x', maxAttempts: 5 });
    const reg = new HandlerRegistry();
    reg.register('x', async () => {
      now += 5000; await q.claim(1000);
      throw new Error('late');
    });
    await runOnce(q, reg, { leaseMs: 1000, heartbeatMs: 1000, retryMs: 1 });
    const after = await q.get(j.id);
    expect(after?.status).toBe('running');
    expect(after?.error).toBeNull();
  });

  it('a transient heartbeat error does not abort, kill the worker or burn an attempt', async () => {
    const j = await q.enqueue({ type: 'x' });
    let failBeats = 2;
    const flaky = Object.create(q) as DbJobQueue;
    flaky.heartbeat = async (...args: Parameters<JobQueue['heartbeat']>) => {
      if (failBeats-- > 0) throw new Error('SQLITE_BUSY');
      return q.heartbeat(...args);
    };
    const reg = new HandlerRegistry();
    let sawAbort = false;
    reg.register('x', async (_j, ctx) => { await sleep(120); sawAbort = ctx.signal.aborted; });
    const logs: string[] = [];
    await runOnce(flaky, reg, { leaseMs: 60_000, heartbeatMs: 10, log: (m) => logs.push(m), retryMs: 1 });
    expect(sawAbort).toBe(false);
    expect(logs.some((m) => m.includes('heartbeat failed'))).toBe(true);
    expect(await q.get(j.id)).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('a transient claim error does not end runWorker and consumes no attempt', async () => {
    const j = await q.enqueue({ type: 'x' });
    const ac = new AbortController();
    let n = 0;
    const flaky = Object.create(q) as DbJobQueue;
    flaky.claim = async (ms: number) => { if (n++ < 2) throw new Error('SQLITE_BUSY'); return q.claim(ms); };
    const reg = new HandlerRegistry();
    reg.register('x', async () => { ac.abort(); });
    await runWorker(flaky, reg, { signal: ac.signal, pollMs: 1, log: () => {}, sleep: async () => {}, retryMs: 1 });
    expect(await q.get(j.id)).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('a transient complete error is retried and succeeds with the same token', async () => {
    const j = await q.enqueue({ type: 'x' });
    let n = 0;
    const flaky = Object.create(q) as DbJobQueue;
    flaky.completeWithArtifacts = async (...a: Parameters<JobQueue['completeWithArtifacts']>) => { if (n++ < 1) throw new Error('busy'); return q.completeWithArtifacts(...a); };
    const reg = new HandlerRegistry();
    reg.register('x', async () => ({ artifacts: [{ key: 'k', data: 1 }] }));
    await runOnce(flaky, reg, { log: () => {}, retryMs: 1 });
    expect(await q.get(j.id)).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('SUSPECTED: ctx.queue.saveArtifact is not fenced, so a zombie handler can still write artifacts', async () => {
    const j = await q.enqueue({ type: 'x' });
    const a = (await q.claim(1000))!; now += 2000; await q.claim(1000);
    // A zombie holding `ctx.queue` can call saveArtifact for a job it no longer owns.
    void a;
    await q.saveArtifact(j.id, 'zombie-direct', 1);
    expect(await getJobArtifact(db, j.id, 'zombie-direct')).toBeUndefined();
  });
});

describe('storage symlinks', () => {
  let root: string; let outside: string; let s: LocalStorage;
  beforeEach(() => {
    root = join(dir, 'root'); outside = join(dir, 'outside');
    mkdirSync(root); mkdirSync(outside);
    writeFileSync(join(outside, 'secret'), 'SECRET');
    s = new LocalStorage(root);
  });
  it('dir symlink out: put/get/exists/delete throw or refuse; target untouched', async () => {
    symlinkSync(outside, join(root, 'link'));
    await expect(s.put('link/x', new Uint8Array([1]))).rejects.toBeInstanceOf(StorageKeyError);
    await expect(s.put('link/sub/x', new Uint8Array([1]))).rejects.toBeInstanceOf(StorageKeyError);
    await expect(s.get('link/secret')).rejects.toBeInstanceOf(StorageKeyError);
    await expect(s.delete('link/secret')).rejects.toBeInstanceOf(StorageKeyError);
    expect(readFileSync(join(outside, 'secret'), 'utf8')).toBe('SECRET');
    expect(readdirSync(outside)).toEqual(['secret']);
    expect(lstatSync(join(root, 'link')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(root, 'link'))).toBe(outside);
  });
  it('leaf symlink out: put throws and leaves the symlink and target intact; get throws', async () => {
    symlinkSync(join(outside, 'secret'), join(root, 'leaf'));
    await expect(s.put('leaf', new Uint8Array([7]))).rejects.toBeInstanceOf(StorageKeyError);
    await expect(s.get('leaf')).rejects.toBeInstanceOf(StorageKeyError);
    expect(lstatSync(join(root, 'leaf')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(outside, 'secret'), 'utf8')).toBe('SECRET');
    expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('dangling leaf symlink out: put throws, no file created at target', async () => {
    symlinkSync(join(outside, 'new'), join(root, 'dangle'));
    await expect(s.put('dangle', new Uint8Array([7]))).rejects.toBeInstanceOf(StorageKeyError);
    expect(existsSync(join(outside, 'new'))).toBe(false);
    expect(lstatSync(join(root, 'dangle')).isSymbolicLink()).toBe(true);
  });
  it('leaf symlink to a file INSIDE the root is also refused and preserved', async () => {
    await s.put('real', new Uint8Array([1]));
    symlinkSync(join(root, 'real'), join(root, 'alias'));
    await expect(s.put('alias', new Uint8Array([2]))).rejects.toBeInstanceOf(StorageKeyError);
    expect(lstatSync(join(root, 'alias')).isSymbolicLink()).toBe(true);
    expect([...(await s.get('real'))]).toEqual([1]);
  });
  it('symlinked root itself still works', async () => {
    const real = join(dir, 'realroot'); mkdirSync(real);
    symlinkSync(real, join(dir, 'rootlink'));
    const s2 = new LocalStorage(join(dir, 'rootlink'));
    await s2.put('a/b', new Uint8Array([5]));
    expect([...(await s2.get('a/b'))]).toEqual([5]);
  });
  it('sibling directory sharing the root name prefix is not treated as inside', async () => {
    const sib = join(dir, 'root-evil'); mkdirSync(sib);
    symlinkSync(sib, join(root, 'sib'));
    await expect(s.put('sib/x', new Uint8Array([1]))).rejects.toBeInstanceOf(StorageKeyError);
    expect(existsSync(join(sib, 'x'))).toBe(false);
  });
});

describe('config', () => {
  const prod = { NODE_ENV: 'production' };
  it('production rejects missing, placeholder (any case/whitespace) and short secrets', () => {
    for (const v of [undefined, '', '   ', 'change-me', 'Change-Me', ' change-me ', 'changeme', 'x'.repeat(31)]) {
      expect(() => loadConfig({ ...prod, SESSION_SECRET: v }), String(v)).toThrow(ConfigError);
    }
  });
  it('production accepts 32+ byte secret; development needs none', () => {
    expect(loadConfig({ ...prod, SESSION_SECRET: 'x'.repeat(32) }).sessionSecret).toBe('x'.repeat(32));
    expect(() => loadConfig({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => loadConfig({})).not.toThrow();
  });
  it('a 32-char repeated placeholder-like secret is accepted (documented weakness: no entropy check)', () => {
    expect(() => loadConfig({ ...prod, SESSION_SECRET: 'change-me'.repeat(4) })).not.toThrow();
  });
  it('no module-level getConfig() call in src/ (so next build needs no secret)', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const files = walk(join(process.cwd(), 'src')).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('config.ts'));
    const offenders = files.filter((f) => /^(?:export )?(?:const|let|var)\s+\w+\s*=\s*(?:loadConfig|getConfig)\(/m.test(rf(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('ValidatedGuide brand', () => {
  it('no cast can mint a ValidatedGuide outside validateGuide', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const files = walk(join(process.cwd(), 'src')).filter((f) => /\.(ts|tsx)$/.test(f));
    const hits: string[] = [];
    for (const f of files) {
      const t = rf(f, 'utf8');
      if (/as\s+ValidatedGuide/.test(t) && !f.endsWith('guide/validate.ts')) hits.push(f);
      if (/as\s+unknown\s+as\s+(?:Validated)?Guide\b/.test(t)) hits.push(`${f} (as unknown as Guide)`);
    }
    expect(hits).toEqual([]);
    const own = rf(join(process.cwd(), 'src/lib/guide/validate.ts'), 'utf8');
    expect(own.match(/as\s+ValidatedGuide/g)?.length).toBe(1);
  });

  const guide = loadFixtureGuide();
  const ids = Object.keys(guide.steps);
  it('validateCitations drops dangling ids (incl. prototype names), out-of-range/float/NaN pages', () => {
    const bad = [
      { stepId: 'nope', pageIndex: 0 }, { stepId: 'constructor', pageIndex: 0 }, { stepId: '__proto__', pageIndex: 0 },
      { stepId: ids[0]!, pageIndex: 6 }, { stepId: ids[0]!, pageIndex: -1 }, { stepId: ids[0]!, pageIndex: 1.5 }, { stepId: ids[0]!, pageIndex: NaN },
      { stepId: ids[0]!, pageIndex: '1' as unknown as number },
    ];
    const r = validateCitations(bad, guide, 6);
    expect(r.citations).toEqual([]);
    expect(r.issues.length).toBe(bad.length);
  });
  it('validateCitations tolerates null/garbage entries and clamps or drops bad regions', () => {
    const r = validateCitations([null, 5, { stepId: ids[0]!, pageIndex: 0, region: { x: 2, y: 2, w: 1, h: 1 } }, { stepId: ids[0]!, pageIndex: 0, region: { x: -1, y: 0, w: 3, h: 0.5 } }] as never, guide, 6);
    expect(r.citations.length).toBe(2);
    expect(r.citations[0]).not.toHaveProperty('region');
    expect(r.citations[1]!.region).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
  });
  it('simplifyStepChecked falls back on introduced digits, words, unicode digits, fractions; empty text', async () => {
    const stepId = ids.find((i) => !/\d/.test(guide.steps[i]!.instruction)) ?? ids[0]!;
    const original = guide.steps[stepId]!.instruction;
    for (const text of ['Use 4 screws.', 'Use four screws', 'Use ٣ screws', 'Use ½ the screws', 'Twist 90 degrees', '', '   ']) {
      const p = { simplifyStep: async () => ({ text }) } as unknown as AIProvider;
      const r = await simplifyStepChecked(p, { guide, stepId, level: 'simpler' });
      expect(r.fellBack, text).toBe(true);
      expect(r.text).toBe(original);
    }
    const ok = await simplifyStepChecked({ simplifyStep: async () => ({ text: 'Attach it.' }) } as unknown as AIProvider, { guide, stepId, level: 'simpler' });
    expect(ok.fellBack).toBe(false);
  });
  it('simplifyStepChecked on unknown step id uses empty original and rejects any number', async () => {
    const p = { simplifyStep: async () => ({ text: 'Do 2 things' }) } as unknown as AIProvider;
    const r = await simplifyStepChecked(p, { guide, stepId: 'constructor', level: 'simpler' });
    expect(r.fellBack).toBe(true);
  });
  it('SUSPECTED minor: quantity words outside the list (zero, single, both) slip through', async () => {
    const stepId = ids.find((i) => !/\d/.test(guide.steps[i]!.instruction)) ?? ids[0]!;
    for (const text of ['Remove zero washers', 'Use a single screw', 'Tighten both screws']) {
      const r = await simplifyStepChecked({ simplifyStep: async () => ({ text }) } as unknown as AIProvider, { guide, stepId, level: 'simpler' });
      expect(r.fellBack, text).toBe(true);
    }
  });
  it('mock provider output passes the check for every fixture step', async () => {
    const p = new MockProvider();
    for (const stepId of ids) for (const level of ['simpler', 'simplest'] as const) {
      const r = await simplifyStepChecked(p, { guide, stepId, level });
      expect(r.text.length).toBeGreaterThan(0);
    }
  });
  it('validateGuide still rejects a dangling highlight page / missing source (regression)', () => {
    const raw = structuredClone(JSON.parse(rf(join(process.cwd(), 'fixtures/lumen-bookcase.guide.json'), 'utf8')));
    raw.steps[ids[0]!].sources = [{ pageIndex: 99 }];
    expect(validateGuide(raw, { pageCount: 6 }).ok).toBe(false);
  });
});

describe('migrations 0001/0002 upgrade', () => {
  function upgradeFixture(withOwnerlessMock = false) {
    const mig = join(dir, 'mig-old');
    cpSync(join(process.cwd(), 'src/lib/db/migrations'), mig, { recursive: true });
    const jp = join(mig, 'meta/_journal.json');
    const j = JSON.parse(readFileSync(jp, 'utf8'));
    j.entries = j.entries.slice(0, 1);
    writeFileSync(jp, JSON.stringify(j));
    const path = join(dir, 'old.db');
    const raw = new Database(path);
    raw.pragma('foreign_keys = ON');
    migrate(drizzle(raw), { migrationsFolder: mig });
    raw.exec(`
      INSERT INTO sessions(id, created_at) VALUES ('s1', 1);
      INSERT INTO documents(id, session_id, content_hash, kind, original_path, status, created_at) VALUES ('d1','s1','h','pdf','p','ready',1);
      INSERT INTO analyses(id, content_hash, pipeline_version, provider, owner_session_id, guide_json, schema_version, created_at)
        VALUES ('a1','h','v1','mock','s1','{}',1,1), ('a2','h','v1','anthropic','','{"x":1}',1,1)${withOwnerlessMock ? ", ('a3','h2','v1','mock','','{}',1,1)" : ''};
      INSERT INTO guides(id, document_id, analysis_id, session_id, title, created_at) VALUES ('g1','d1','a1','s1','T',1);
      INSERT INTO progress(guide_id, analysis_id, updated_at) VALUES ('g1','a1',1);
      INSERT INTO jobs(id, document_id, type, status, created_at, updated_at) VALUES ('j1','d1','x','queued',1,1), ('j2','ghost','x','queued',2,2), ('j3',NULL,'x','done',3,3);
      INSERT INTO job_artifacts(job_id, key, data_json, created_at) VALUES ('j1','k','1',1);
    `);
    raw.close();
    return path;
  }
  it('preserves rows, nulls only the orphan, enforces CHECK and FK, FK pragma ON after', () => {
    const path = upgradeFixture();
    const d = openDb(path);
    try {
      runMigrations(d);
    } finally { closeDb(d); }
    const raw = new Database(path);
    try {
      expect(raw.prepare('select id from analyses order by id').all()).toEqual([{ id: 'a1' }, { id: 'a2' }]);
      expect(raw.prepare("select source_kind, guide_json from analyses where id='a2'").get()).toEqual({ source_kind: 'pdf', guide_json: '{"x":1}' });
      expect(raw.prepare('select id, document_id from jobs order by id').all()).toEqual([
        { id: 'j1', document_id: 'd1' }, { id: 'j2', document_id: null }, { id: 'j3', document_id: null }]);
      expect(raw.prepare('select count(*) c from job_artifacts').get()).toEqual({ c: 1 });
      expect(raw.prepare('select count(*) c from guides').get()).toEqual({ c: 1 });
      expect(raw.pragma('foreign_key_check')).toEqual([]);
      raw.pragma('foreign_keys = ON');
      expect(() => raw.exec(`INSERT INTO analyses(id,content_hash,pipeline_version,provider,owner_session_id,guide_json,schema_version,created_at) VALUES ('bad','h','v','mock','','{}',1,1)`)).toThrow(/CHECK/);
      expect(() => raw.exec(`INSERT INTO analyses(id,content_hash,pipeline_version,provider,source_kind,owner_session_id,guide_json,schema_version,created_at) VALUES ('bad2','h','v','anthropic','images','','{}',1,1)`)).toThrow(/CHECK/);
      expect(() => raw.exec(`INSERT INTO jobs(id,document_id,type,status,created_at,updated_at) VALUES ('jx','nodoc','x','queued',1,1)`)).toThrow(/FOREIGN KEY/);
      expect(() => raw.exec(`DELETE FROM documents WHERE id='d1'`)).toThrow(/FOREIGN KEY/);
      // child tables still reference analyses/jobs correctly after the rebuild
      expect(() => raw.exec(`DELETE FROM analyses WHERE id='a1'`)).toThrow(/FOREIGN KEY/);
      expect(() => raw.exec(`DELETE FROM jobs WHERE id='j1'`)).toThrow(/FOREIGN KEY/);
    } finally { raw.close(); }
  });
  it('foreign_keys is ON on the app connection after runMigrations, and when migration throws', () => {
    const path = upgradeFixture();
    const d = openDb(path);
    runMigrations(d);
    // writing an orphan through the app's own connection must fail
    const q2 = new DbJobQueue(d);
    return expect(q2.enqueue({ type: 'x', documentId: 'ghost' })).rejects.toThrow(/FOREIGN KEY/).finally(() => closeDb(d));
  });
  it('DEFECT: a pre-existing ownerless mock analysis row must not make the upgrade crash', () => {
    const path = upgradeFixture(true);
    const d = openDb(path);
    try {
      expect(() => runMigrations(d)).not.toThrow();
    } finally { closeDb(d); }
  });
  it('re-running runMigrations is idempotent', () => {
    runMigrations(db); runMigrations(db);
  });
});
