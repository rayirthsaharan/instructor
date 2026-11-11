import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, closeDb, runMigrations, type Db } from '@/lib/db';
import { DbJobQueue, HandlerRegistry, runOnce, runWorker, type JobQueue } from '@/lib/jobs';

let dir: string;
let db: Db;
let now: number;
let q: DbJobQueue;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jobs-'));
  db = openDb(join(dir, 't.db'));
  runMigrations(db);
  now = 1_000_000;
  q = new DbJobQueue(db, () => now);
});
afterEach(() => {
  closeDb(db);
  rmSync(dir, { recursive: true, force: true });
});

const quiet = { log: () => {}, retryMs: 1 };

describe('DbJobQueue', () => {
  it('claims queued jobs in order and returns nothing when empty', async () => {
    const a = await q.enqueue({ type: 'noop' });
    now += 1;
    const b = await q.enqueue({ type: 'noop' });
    expect((await q.claim(1000))?.id).toBe(a.id);
    expect((await q.claim(1000))?.id).toBe(b.id);
    expect(await q.claim(1000)).toBeUndefined();
    expect(await q.get(a.id)).toMatchObject({ status: 'running', attempts: 1 });
  });

  it('two competing claimers (separate connections) never get the same job', async () => {
    const db2 = openDb(join(dir, 't.db'));
    const q2 = new DbJobQueue(db2, () => now);
    const job = await q.enqueue({ type: 'noop' });
    const r1 = await q.claim(1000);
    const r2 = await q2.claim(1000);
    expect([r1?.id, r2?.id].filter(Boolean)).toEqual([job.id]);
    await q.enqueue({ type: 'noop' });
    const r3 = await q2.claim(1000);
    expect(r3 && r3.id !== job.id).toBe(true);
    closeDb(db2);
  });

  it('does not reclaim a live lease; reclaims after expiry and counts the attempt', async () => {
    const job = await q.enqueue({ type: 'noop' });
    await q.claim(1000);
    now += 999;
    expect(await q.claim(1000)).toBeUndefined();
    now += 2;
    const again = await q.claim(1000);
    expect(again?.id).toBe(job.id);
    expect(again?.attempts).toBe(2);
  });

  it('heartbeat extends the lease and reports a lost lease', async () => {
    const job = await q.enqueue({ type: 'noop' });
    const c = (await q.claim(1000))!;
    now += 900;
    expect(await q.heartbeat(job.id, 1000, c.attempts, { stage: 'render', progress: 40 })).toBe(true);
    now += 900;
    expect(await q.claim(1000)).toBeUndefined();
    expect(await q.get(job.id)).toMatchObject({ stage: 'render', progress: 40 });
    await q.complete(job.id, c.attempts);
    expect(await q.heartbeat(job.id, 1000, c.attempts)).toBe(false);
  });

  it('fails a job whose lease expires after the attempt cap', async () => {
    const job = await q.enqueue({ type: 'noop', maxAttempts: 2 });
    await q.claim(10);
    now += 11;
    await q.claim(10);
    now += 11;
    expect(await q.claim(10)).toBeUndefined();
    expect((await q.get(job.id))?.status).toBe('failed');
  });

  it('fail() requeues until the cap, then fails permanently', async () => {
    const job = await q.enqueue({ type: 'noop', maxAttempts: 2 });
    const c1 = (await q.claim(1000))!;
    expect((await q.fail(job.id, 'boom', c1.attempts))?.status).toBe('queued');
    const c2 = (await q.claim(1000))!;
    expect(await q.fail(job.id, 'boom2', c2.attempts)).toMatchObject({ status: 'failed', error: 'boom2' });
    expect(await q.claim(1000)).toBeUndefined();
  });

  it('complete marks done and is not repeatable', async () => {
    const job = await q.enqueue({ type: 'noop' });
    const c = (await q.claim(1000))!;
    expect(await q.complete(job.id, c.attempts)).toBe(true);
    expect(await q.complete(job.id, c.attempts)).toBe(false);
    expect((await q.get(job.id))?.status).toBe('done');
  });

  it('a stale token cannot heartbeat, complete, fail or write results after a re-claim', async () => {
    const job = await q.enqueue({ type: 'noop' });
    const a = (await q.claim(1000))!;
    now += 2000;
    const b = (await q.claim(1000))!;
    expect(b.attempts).toBe(a.attempts + 1);
    expect(await q.heartbeat(job.id, 1000, a.attempts)).toBe(false);
    expect(await q.complete(job.id, a.attempts)).toBe(false);
    expect(await q.completeWithArtifacts(job.id, a.attempts, [{ key: 'zombie', data: 1 }])).toBe(false);
    expect(await q.fail(job.id, 'x', a.attempts)).toBeUndefined();
    expect(await q.getArtifact(job.id, 'zombie')).toBeUndefined();
    expect(await q.get(job.id)).toMatchObject({ status: 'running', attempts: b.attempts });
    expect(await q.completeWithArtifacts(job.id, b.attempts, [{ key: 'k', data: { ok: true } }])).toBe(true);
    expect(await q.getArtifact(job.id, 'k')).toEqual({ ok: true });
    expect((await q.get(job.id))?.status).toBe('done');
  });

  it('completeWithArtifacts is all-or-nothing: a failing artifact write leaves the job running', async () => {
    const job = await q.enqueue({ type: 'noop' });
    const c = (await q.claim(1000))!;
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(q.completeWithArtifacts(job.id, c.attempts, [{ key: 'a', data: 1 }, { key: 'b', data: circular }])).rejects.toThrow();
    expect(await q.getArtifact(job.id, 'a')).toBeUndefined();
    expect((await q.get(job.id))?.status).toBe('running');
  });

  it('stores job artifacts once per key', async () => {
    const job = await q.enqueue({ type: 'noop' });
    const c = (await q.claim(1000))!;
    expect(await q.saveArtifact(job.id, 'chunk-1', { a: 1 }, c.attempts)).toBe(true);
    await q.saveArtifact(job.id, 'chunk-1', { a: 2 }, c.attempts);
    expect(await q.getArtifact(job.id, 'chunk-1')).toEqual({ a: 1 });
    expect(await q.getArtifact(job.id, 'chunk-2')).toBeUndefined();
  });

  it('saveArtifact is fenced: stale token, missing token and non-running jobs write nothing', async () => {
    const job = await q.enqueue({ type: 'noop' });
    expect(await q.saveArtifact(job.id, 'k', 1, 1)).toBe(false); // queued, not running
    const a = (await q.claim(1000))!;
    now += 2000;
    const b = (await q.claim(1000))!;
    expect(await q.saveArtifact(job.id, 'k', 1, a.attempts)).toBe(false);
    expect(await q.saveArtifact(job.id, 'k', 1)).toBe(false);
    expect(await q.getArtifact(job.id, 'k')).toBeUndefined();
    expect(await q.saveArtifact(job.id, 'k', 2, b.attempts)).toBe(true);
    expect(await q.getArtifact(job.id, 'k')).toBe(2);
  });

  it('rejects a job whose documentId is not a document (foreign key)', async () => {
    await expect(q.enqueue({ type: 'noop', documentId: 'no-such-doc' })).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe('runOnce', () => {
  it('dispatches to the handler and completes', async () => {
    const reg = new HandlerRegistry();
    let seen: unknown;
    reg.register('noop', async (j) => {
      seen = j.payload;
    });
    const job = await q.enqueue({ type: 'noop', payload: { x: 1 } });
    expect(await runOnce(q, reg)).toBe(true);
    expect(seen).toEqual({ x: 1 });
    expect((await q.get(job.id))?.status).toBe('done');
    expect(await runOnce(q, reg)).toBe(false);
  });

  it('persists handler results atomically with completion', async () => {
    const reg = new HandlerRegistry();
    reg.register('noop', async () => ({ artifacts: [{ key: 'out', data: [1, 2] }] }));
    const job = await q.enqueue({ type: 'noop' });
    await runOnce(q, reg);
    expect(await q.getArtifact(job.id, 'out')).toEqual([1, 2]);
    expect((await q.get(job.id))?.status).toBe('done');
  });

  it('records handler errors and unknown types as failures', async () => {
    const reg = new HandlerRegistry();
    reg.register('bad', async () => {
      throw new Error('kaput');
    });
    const bad = await q.enqueue({ type: 'bad', maxAttempts: 1 });
    const unknown = await q.enqueue({ type: 'zzz', maxAttempts: 1 });
    await runOnce(q, reg);
    await runOnce(q, reg);
    expect(await q.get(bad.id)).toMatchObject({ status: 'failed', error: 'kaput' });
    expect((await q.get(unknown.id))?.status).toBe('failed');
  });

  it('aborts the handler signal when the lease is lost and never completes the job for a zombie', async () => {
    const reg = new HandlerRegistry();
    let sawAbort = false;
    const job = await q.enqueue({ type: 'slow', maxAttempts: 3 });
    reg.register('slow', async (_j, ctx) => {
      // Another worker takes the job over: expire the lease and re-claim from a second connection.
      now += 5000;
      const db2 = openDb(join(dir, 't.db'));
      const other = await new DbJobQueue(db2, () => now).claim(1000);
      closeDb(db2);
      expect(other?.id).toBe(job.id);
      expect(await ctx.heartbeat()).toBe(false);
      sawAbort = ctx.signal.aborted;
      return { artifacts: [{ key: 'zombie', data: 1 }] };
    });
    await runOnce(q, reg, { leaseMs: 1000, heartbeatMs: 100_000, ...quiet });
    expect(sawAbort).toBe(true);
    expect(await q.getArtifact(job.id, 'zombie')).toBeUndefined();
    expect(await q.get(job.id)).toMatchObject({ status: 'running', attempts: 2 });
  });

  it('survives database errors in the heartbeat timer and does not fail or burn the job', async () => {
    const logs: string[] = [];
    let beats = 0;
    const flaky: JobQueue = Object.create(q) as JobQueue;
    flaky.heartbeat = async (...a: Parameters<JobQueue['heartbeat']>) => {
      beats += 1;
      if (beats === 1) throw new Error('SQLITE_BUSY: database is locked');
      return q.heartbeat(...a);
    };
    const reg = new HandlerRegistry();
    let signalAbortedDuring = true;
    reg.register('noop', async (_j, ctx) => {
      await new Promise((r) => setTimeout(r, 80));
      signalAbortedDuring = ctx.signal.aborted;
    });
    const job = await q.enqueue({ type: 'noop' });
    await runOnce(flaky, reg, { leaseMs: 60_000, heartbeatMs: 10, log: (m) => logs.push(m), retryMs: 1 });
    expect(beats).toBeGreaterThan(1);
    expect(logs.some((m) => m.includes('heartbeat failed'))).toBe(true);
    expect(signalAbortedDuring).toBe(false);
    expect(await q.get(job.id)).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('aborts the signal if heartbeats keep failing until the lease must have expired', async () => {
    let t = 0;
    const broken: JobQueue = Object.create(q) as JobQueue;
    broken.heartbeat = async () => {
      throw new Error('SQLITE_BUSY');
    };
    const reg = new HandlerRegistry();
    let aborted = false;
    reg.register('noop', async (_j, ctx) => {
      t += 2000;
      await ctx.heartbeat();
      aborted = ctx.signal.aborted;
    });
    await q.enqueue({ type: 'noop' });
    await runOnce(broken, reg, { leaseMs: 1000, heartbeatMs: 100_000, now: () => t, ...quiet });
    expect(aborted).toBe(true);
  });

  it('retries a transient error while completing instead of failing the job', async () => {
    let calls = 0;
    const flaky: JobQueue = Object.create(q) as JobQueue;
    flaky.completeWithArtifacts = async (...a: Parameters<JobQueue['completeWithArtifacts']>) => {
      calls += 1;
      if (calls === 1) throw new Error('SQLITE_BUSY');
      return q.completeWithArtifacts(...a);
    };
    const reg = new HandlerRegistry();
    reg.register('noop', async () => {});
    const job = await q.enqueue({ type: 'noop' });
    await runOnce(flaky, reg, quiet);
    expect(calls).toBe(2);
    expect(await q.get(job.id)).toMatchObject({ status: 'done', attempts: 1 });
  });
});

describe('runWorker', () => {
  it('logs a poll error, backs off exponentially, recovers and keeps running', async () => {
    const reg = new HandlerRegistry();
    let handled = 0;
    reg.register('noop', async () => {
      handled += 1;
    });
    const job = await q.enqueue({ type: 'noop' });
    let failures = 2;
    const flaky: JobQueue = Object.create(q) as JobQueue;
    flaky.claim = async (ms: number) => {
      if (failures-- > 0) throw new Error('SQLITE_BUSY: database is locked');
      return q.claim(ms);
    };
    const ac = new AbortController();
    const sleeps: number[] = [];
    const logs: string[] = [];
    await runWorker(flaky, reg, {
      signal: ac.signal,
      pollMs: 100,
      maxBackoffMs: 150,
      log: (m) => logs.push(m),
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length >= 3) ac.abort();
      },
    });
    expect(sleeps).toEqual([100, 150, 100]); // backoff 100, capped 150, then idle poll
    expect(logs.filter((m) => m.includes('poll failed'))).toHaveLength(2);
    expect(handled).toBe(1);
    expect((await q.get(job.id))?.status).toBe('done');
  });

  it('a claim error does not burn an attempt', async () => {
    const job = await q.enqueue({ type: 'noop' });
    const flaky: JobQueue = Object.create(q) as JobQueue;
    flaky.claim = async () => {
      throw new Error('SQLITE_BUSY');
    };
    await expect(runOnce(flaky, new HandlerRegistry(), quiet)).rejects.toThrow('SQLITE_BUSY');
    expect(await q.get(job.id)).toMatchObject({ status: 'queued', attempts: 0 });
  });
});
