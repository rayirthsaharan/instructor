import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, closeDb, runMigrations, type Db } from '@/lib/db';
import { DbJobQueue, HandlerRegistry, runOnce } from '@/lib/jobs';

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

describe('DbJobQueue', () => {
  it('claims queued jobs in order and returns nothing when empty', () => {
    const a = q.enqueue({ type: 'noop' });
    now += 1;
    const b = q.enqueue({ type: 'noop' });
    expect(q.claim(1000)?.id).toBe(a.id);
    expect(q.claim(1000)?.id).toBe(b.id);
    expect(q.claim(1000)).toBeUndefined();
    expect(q.get(a.id)).toMatchObject({ status: 'running', attempts: 1 });
  });

  it('two competing claimers (separate connections) never get the same job', () => {
    const db2 = openDb(join(dir, 't.db'));
    const q2 = new DbJobQueue(db2, () => now);
    const job = q.enqueue({ type: 'noop' });
    const r1 = q.claim(1000);
    const r2 = q2.claim(1000);
    expect([r1?.id, r2?.id].filter(Boolean)).toEqual([job.id]);
    // with two jobs, each claimer gets a distinct one
    q.enqueue({ type: 'noop' });
    const r3 = q2.claim(1000);
    expect(r3 && r3.id !== job.id).toBe(true);
    closeDb(db2);
  });

  it('does not reclaim a live lease; reclaims after expiry and counts the attempt', () => {
    const job = q.enqueue({ type: 'noop' });
    q.claim(1000);
    now += 999;
    expect(q.claim(1000)).toBeUndefined();
    now += 2;
    const again = q.claim(1000);
    expect(again?.id).toBe(job.id);
    expect(again?.attempts).toBe(2);
  });

  it('heartbeat extends the lease and reports a lost lease', () => {
    const job = q.enqueue({ type: 'noop' });
    q.claim(1000);
    now += 900;
    expect(q.heartbeat(job.id, 1000, { stage: 'render', progress: 40 })).toBe(true);
    now += 900;
    expect(q.claim(1000)).toBeUndefined();
    expect(q.get(job.id)).toMatchObject({ stage: 'render', progress: 40 });
    q.complete(job.id);
    expect(q.heartbeat(job.id, 1000)).toBe(false);
  });

  it('fails a job whose lease expires after the attempt cap', () => {
    const job = q.enqueue({ type: 'noop', maxAttempts: 2 });
    q.claim(10);
    now += 11;
    q.claim(10);
    now += 11;
    expect(q.claim(10)).toBeUndefined();
    expect(q.get(job.id)?.status).toBe('failed');
  });

  it('fail() requeues until the cap, then fails permanently', () => {
    const job = q.enqueue({ type: 'noop', maxAttempts: 2 });
    q.claim(1000);
    expect(q.fail(job.id, 'boom')?.status).toBe('queued');
    q.claim(1000);
    expect(q.fail(job.id, 'boom2')).toMatchObject({ status: 'failed', error: 'boom2' });
    expect(q.claim(1000)).toBeUndefined();
  });

  it('complete marks done and is not repeatable', () => {
    const job = q.enqueue({ type: 'noop' });
    q.claim(1000);
    expect(q.complete(job.id)).toBe(true);
    expect(q.complete(job.id)).toBe(false);
    expect(q.get(job.id)?.status).toBe('done');
  });

  it('stores job artifacts once per key', () => {
    const job = q.enqueue({ type: 'noop' });
    q.saveArtifact(job.id, 'chunk-1', { a: 1 });
    q.saveArtifact(job.id, 'chunk-1', { a: 2 });
    expect(q.getArtifact(job.id, 'chunk-1')).toEqual({ a: 1 });
    expect(q.getArtifact(job.id, 'chunk-2')).toBeUndefined();
  });
});

describe('runOnce', () => {
  it('dispatches to the handler and completes', async () => {
    const reg = new HandlerRegistry();
    let seen: unknown;
    reg.register('noop', async (j) => {
      seen = j.payload;
    });
    const job = q.enqueue({ type: 'noop', payload: { x: 1 } });
    expect(await runOnce(q, reg)).toBe(true);
    expect(seen).toEqual({ x: 1 });
    expect(q.get(job.id)?.status).toBe('done');
    expect(await runOnce(q, reg)).toBe(false);
  });

  it('records handler errors and unknown types as failures', async () => {
    const reg = new HandlerRegistry();
    reg.register('bad', async () => {
      throw new Error('kaput');
    });
    const bad = q.enqueue({ type: 'bad', maxAttempts: 1 });
    const unknown = q.enqueue({ type: 'zzz', maxAttempts: 1 });
    await runOnce(q, reg);
    await runOnce(q, reg);
    expect(q.get(bad.id)).toMatchObject({ status: 'failed', error: 'kaput' });
    expect(q.get(unknown.id)?.status).toBe('failed');
  });
});
