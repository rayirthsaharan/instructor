import Database from 'better-sqlite3';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteDocumentCascade, ensureSession, insertDocument, listPages, removeUnreferencedFiles, upsertPage } from '@/lib/db';
import { JOB_TYPE } from '@/lib/pipeline/types';
import { contentHashFor } from '@/lib/pipeline/hash';
import { createTestApp, lumenPages, type TestApp } from './helpers/app';

let app: TestApp;
afterEach(() => app?.close());

async function addDoc(a: TestApp, sessionId: string, files: Uint8Array[], run: boolean) {
  await ensureSession(a.db, sessionId, a.clock.now);
  const id = crypto.randomUUID();
  const originals = [];
  for (const [i, f] of files.entries()) {
    const key = `originals/${id}/${i}.png`;
    await a.ctx.storage.put(key, f);
    originals.push({ key, mime: 'image/png', size: f.byteLength });
  }
  await insertDocument(a.db, { id, sessionId, contentHash: contentHashFor('images', files), kind: 'images', originalFiles: originals, pageCount: files.length }, a.clock.now);
  if (run) {
    await a.ctx.queue.enqueue({ type: JOB_TYPE, payload: { documentId: id }, documentId: id });
    await a.drain();
  }
  return id;
}

describe('concurrent delete and shared page-image write', () => {
  it('a reference inserted after the delete committed keeps the file; unreferenced files are still removed', async () => {
    app = createTestApp();
    const files = lumenPages().slice(0, 2);
    const a = await addDoc(app, 's1', files, true);
    const b = await addDoc(app, 's2', files, false); // identical content, not rendered yet
    const pagesA = await listPages(app.db, a);
    expect(pagesA).toHaveLength(2);

    // 1. A is deleted: no other document references its page images yet, so both are reported as orphaned.
    const res = await deleteDocumentCascade(app.db, a, 's1');
    expect(res!.orphanedKeys).toEqual(expect.arrayContaining(pagesA.map((p) => p.imagePath)));

    // 2. B's render inserts its reference (reference first, file second) before the file removal starts.
    const p0 = pagesA[0]!;
    await upsertPage(app.db, { ...p0, documentId: b });

    // 3. The file removal now runs: the referenced image stays, the other is removed.
    const removed = await removeUnreferencedFiles(app.db, res!.orphanedKeys, (k) => app.ctx.storage.deleteSync(k));
    expect(removed).not.toContain(p0.imagePath);
    expect(removed).toContain(pagesA[1]!.imagePath);
    expect(await app.ctx.storage.exists(p0.imagePath)).toBe(true);
    expect(await app.ctx.storage.exists(pagesA[1]!.imagePath)).toBe(false);
  }, 30_000);

  it('while a file is being removed the write lock is held, so no reference can be inserted between the check and the delete', async () => {
    app = createTestApp();
    const a = await addDoc(app, 's1', lumenPages().slice(0, 1), true);
    const [page] = await listPages(app.db, a);
    const res = await deleteDocumentCascade(app.db, a, 's1');
    expect(res!.orphanedKeys).toContain(page!.imagePath);

    const other = new Database(join(app.dir, 't.db'), { timeout: 0 });
    let blocked = '';
    try {
      const removed = await removeUnreferencedFiles(app.db, [page!.imagePath], (k) => {
        // The interleaved writer: another connection tries to take the write lock (as upsertPage would) mid-delete.
        try {
          other.prepare('BEGIN IMMEDIATE').run();
          other.prepare('ROLLBACK').run();
        } catch (e) {
          blocked = (e as { code?: string }).code ?? 'error';
        }
        app.ctx.storage.deleteSync(k);
      });
      expect(removed).toEqual([page!.imagePath]);
    } finally {
      other.close();
    }
    expect(blocked).toBe('SQLITE_BUSY');
    expect(await app.ctx.storage.exists(page!.imagePath)).toBe(false);
  }, 30_000);

  it('deleteSync refuses keys that escape the storage root and ignores missing files', () => {
    app = createTestApp();
    expect(() => app.ctx.storage.deleteSync('../x')).toThrow();
    expect(() => app.ctx.storage.deleteSync('pages/none/0.png')).not.toThrow();
  });
});
