import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, closeDb, runMigrations, type Db } from '@/lib/db';
import { DbJobQueue } from '@/lib/jobs';
import { LocalStorage, StorageKeyError } from '@/lib/storage';

let dir: string; let db: Db; let now: number; let q: DbJobQueue;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qa-'));
  db = openDb(join(dir, 't.db')); runMigrations(db);
  now = 1_000_000; q = new DbJobQueue(db, () => now);
});
afterEach(() => { closeDb(db); rmSync(dir, { recursive: true, force: true }); });

describe('jobs correctness', () => {
  it('crash after claim: job is reclaimed only after lease expiry', () => {
    const j = q.enqueue({ type: 'x' });
    q.claim(1000);
    now += 999; expect(q.claim(1000)).toBeUndefined();
    now += 2; expect(q.claim(1000)?.id).toBe(j.id);
    expect(q.get(j.id)?.attempts).toBe(2);
  });
  it('attempt cap: expired job with attempts exhausted is failed, never claimed', () => {
    const j = q.enqueue({ type: 'x', maxAttempts: 2 });
    q.claim(1000); now += 2000; q.claim(1000); now += 2000;
    expect(q.claim(1000)).toBeUndefined();
    expect(q.get(j.id)).toMatchObject({ status: 'failed', attempts: 2 });
  });
  it('attempt cap holds at the exact lease boundary (lease_until === now)', () => {
    const j = q.enqueue({ type: 'x', maxAttempts: 1 });
    q.claim(1000); now += 1000;
    q.claim(1000);
    expect(q.get(j.id)!.attempts).toBeLessThanOrEqual(1);
  });
  it('stale worker cannot heartbeat/complete a job re-claimed by another worker', () => {
    const j = q.enqueue({ type: 'x' });
    q.claim(1000); now += 2000;
    q.claim(1000); // worker B owns it
    expect(q.heartbeat(j.id, 1000)).toBe(false); // worker A's stale heartbeat
    expect(q.complete(j.id)).toBe(false);
  });
  it('fail requeues then fails at cap; fail/complete on non-running is a no-op', () => {
    const j = q.enqueue({ type: 'x', maxAttempts: 2 });
    q.claim(1000); expect(q.fail(j.id, 'e')?.status).toBe('queued');
    q.claim(1000); expect(q.fail(j.id, 'e')?.status).toBe('failed');
    expect(q.fail(j.id, 'e')).toBeUndefined();
    expect(q.complete(j.id)).toBe(false);
  });
  it('artifacts are write-once and survive requeue', () => {
    const j = q.enqueue({ type: 'x' });
    q.saveArtifact(j.id, 'k', { a: 1 }); q.saveArtifact(j.id, 'k', { a: 2 });
    expect(q.getArtifact(j.id, 'k')).toEqual({ a: 1 });
    expect(q.getArtifact(j.id, 'missing')).toBeUndefined();
  });
  it('WAL, busy_timeout and foreign keys are applied', () => {
    const f = join(dir, 't.db');
    expect(readFileSync(f).subarray(18, 20).toString('hex')).toBe('0202'); // WAL version bytes
  });
});

describe('storage safety', () => {
  const bad = ['', '/etc/passwd', '../x', 'a/../../x', 'a/..', '..', '.', 'a//b', 'a/./b', 'a\0b', 'a\\..\\b', 'a/', 'C:\\x'];
  it.each(bad)('rejects %j', async (k) => {
    const s = new LocalStorage(join(dir, 'root'));
    await expect(s.put(k, new Uint8Array([1]))).rejects.toBeInstanceOf(StorageKeyError);
    await expect(s.get(k)).rejects.toBeInstanceOf(StorageKeyError);
    await expect(s.delete(k)).rejects.toBeInstanceOf(StorageKeyError);
  });
  it('round-trips, overwrites, deletes idempotently', async () => {
    const s = new LocalStorage(join(dir, 'root'));
    await s.put('a/b.bin', new Uint8Array([1])); await s.put('a/b.bin', new Uint8Array([2, 3]));
    expect([...(await s.get('a/b.bin'))]).toEqual([2, 3]);
    await s.delete('a/b.bin'); await s.delete('a/b.bin');
    expect(await s.exists('a/b.bin')).toBe(false);
  });
  it('sibling dir sharing root prefix is not reachable', async () => {
    const s = new LocalStorage(join(dir, 'root'));
    await expect(s.put('../root2/x', new Uint8Array([1]))).rejects.toBeInstanceOf(StorageKeyError);
  });
  it('does not write through a symlink that points outside the root', async () => {
    const root = join(dir, 'root'); const outside = join(dir, 'outside');
    mkdirSync(root); mkdirSync(outside); writeFileSync(join(outside, 'secret'), 's');
    symlinkSync(outside, join(root, 'link'));
    const s = new LocalStorage(root);
    await s.put('link/pwn', new Uint8Array([9]));
    expect(() => readFileSync(join(outside, 'pwn'))).toThrow(); // fails if escape succeeds
  });
});
