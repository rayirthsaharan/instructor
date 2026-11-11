import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as postDocument } from '@/app/api/documents/route';
import { GET as getDoc, DELETE as deleteDoc } from '@/app/api/documents/[id]/route';
import { POST as retryDoc } from '@/app/api/documents/[id]/retry/route';
import { GET as getImage } from '@/app/api/documents/[id]/pages/[index]/image/route';
import { GET as getOriginal } from '@/app/api/documents/[id]/original/route';
import { GET as listGuides } from '@/app/api/guides/route';
import { GET as getGuide, DELETE as deleteGuide } from '@/app/api/guides/[id]/route';
import { PUT as putProgress } from '@/app/api/guides/[id]/progress/route';
import { SESSION_COOKIE, signSessionId } from '@/lib/session/cookie';
import { UPLOAD_LIMIT_PER_SESSION } from '@/lib/limits';
import { createTestApp, fixture, lumenPages, TestClient, uploadForm, type TestApp } from './helpers/app';

let app: TestApp;
beforeEach(() => {
  app = createTestApp();
});
afterEach(() => app.close());

const upload = (c: TestClient, ...files: Uint8Array[]) =>
  c.call(postDocument, '/api/documents', { method: 'POST', body: uploadForm(...files.map((data) => ({ data }))) });
const status = async (c: TestClient, id: string) => (await c.call(getDoc, `/api/documents/${id}`, {}, { id })).json();

async function readyGuide(c: TestClient, file = fixture('lumen-bookcase.pdf')) {
  const res = await upload(c, file);
  expect(res.status).toBe(201);
  const { documentId } = await res.json();
  await app.drain();
  const s = await status(c, documentId);
  return { documentId: documentId as string, guideId: s.guideId as string, status: s };
}

describe('session cookie', () => {
  it('is created on the first call: signed, httpOnly, SameSite=Lax', async () => {
    const res = await new TestClient().call(listGuides, '/api/guides');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(await res.json()).toEqual([]);
  });

  it('is not re-sent once valid, and a forged or tampered cookie gets a fresh session', async () => {
    const c = new TestClient();
    await c.call(listGuides, '/api/guides');
    expect((await c.call(listGuides, '/api/guides')).headers.get('set-cookie')).toBeNull();
    const forged = new TestClient();
    forged.cookie = `${SESSION_COOKIE}=${encodeURIComponent(signSessionId(crypto.randomUUID(), 'wrong-secret'))}`;
    expect((await forged.call(listGuides, '/api/guides')).headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`);
  });
});

describe('POST /api/documents', () => {
  it('201 with documentId, then status moves from queued to ready', async () => {
    const c = new TestClient();
    const res = await upload(c, fixture('lumen-bookcase.pdf'));
    expect(res.status).toBe(201);
    const { documentId } = await res.json();
    expect(await status(c, documentId)).toMatchObject({ id: documentId, status: 'queued', stage: null, progress: 0, pageCount: 6, pagesRendered: 0, guideId: null, error: null, title: null });
    await app.drain();
    expect(await status(c, documentId)).toMatchObject({
      status: 'ready', stage: null, progress: 1, pageCount: 6, pagesRendered: 6, error: null, title: 'Lumen 3-shelf bookcase',
      guideId: expect.any(String),
    });
  }, 30_000);

  it.each([
    ['empty', 400, () => uploadForm()],
    ['unsupported_type', 415, () => uploadForm({ data: Buffer.from('just text') })],
    ['unsupported_type', 415, () => uploadForm({ data: Buffer.from('\0\0\0\x18ftypheic\0\0\0\0'), name: 'IMG.HEIC', type: 'image/heic' })],
    ['encrypted_pdf', 422, () => uploadForm({ data: fixture('encrypted.pdf') })],
    ['corrupt_file', 422, () => uploadForm({ data: Buffer.from('%PDF-1.4 nope') })],
  ])('%s -> %i with { error: { code, message } }', async (code, httpStatus, form) => {
    const res = await new TestClient().call(postDocument, '/api/documents', { method: 'POST', body: form() });
    expect(res.status).toBe(httpStatus);
    const body = await res.json();
    expect(body).toEqual({ error: { code, message: expect.any(String) } });
  });

  it('rejects a spoofed declared type: an HTML file named .pdf is unsupported', async () => {
    const res = await new TestClient().call(postDocument, '/api/documents', {
      method: 'POST',
      body: uploadForm({ data: Buffer.from('<html><script>alert(1)</script></html>'), name: 'manual.pdf', type: 'application/pdf' }),
    });
    expect((await res.json()).error.code).toBe('unsupported_type');
  });

  it('too_large (413) from the declared length, too_many_pages (422) for 61 photos', async () => {
    const c = new TestClient();
    const big = await c.call(postDocument, '/api/documents', { method: 'POST', body: uploadForm({ data: fixture('mock-failure.pdf') }), headers: { 'content-length': String(60 * 1024 * 1024) } });
    expect(big.status).toBe(413);
    expect((await big.json()).error.code).toBe('too_large');
    const one = lumenPages()[0]!;
    const many = await c.call(postDocument, '/api/documents', { method: 'POST', body: uploadForm(...Array.from({ length: 61 }, () => ({ data: one }))) });
    expect(many.status).toBe(422);
    expect((await many.json()).error.code).toBe('too_many_pages');
  });

  it('non-multipart bodies are unsupported_type', async () => {
    const res = await new TestClient().call(postDocument, '/api/documents', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(415);
  });

  it('rate_limited (429, Retry-After) per session, and per IP across sessions', async () => {
    const c = new TestClient();
    for (let i = 0; i < UPLOAD_LIMIT_PER_SESSION.limit; i++) expect((await upload(c, fixture('mock-failure.pdf'))).status).toBe(201);
    const blocked = await upload(c, fixture('mock-failure.pdf'));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe('rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    app.clock.now += UPLOAD_LIMIT_PER_SESSION.windowMs + 1;
    expect((await upload(c, fixture('mock-failure.pdf'))).status).toBe(201);

    // IP limit: many fresh sessions from one address
    let last = 201;
    for (let i = 0; i < 40 && last === 201; i++) {
      last = (await new TestClient().call(postDocument, '/api/documents', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body: uploadForm({ data: fixture('mock-failure.pdf') }) })).status;
    }
    expect(last).toBe(429);
  }, 60_000);
});

describe('document status outcomes', () => {
  it('not a manual -> status rejected with code not_a_manual', async () => {
    const c = new TestClient();
    const { documentId } = await (await upload(c, fixture('not-a-manual.pdf'))).json();
    await app.drain();
    expect(await status(c, documentId)).toMatchObject({ status: 'rejected', guideId: null, error: { code: 'not_a_manual' } });
  });

  it('failure -> failed with a message, retry re-enqueues, and a non-failed document cannot be retried', async () => {
    const c = new TestClient();
    const { documentId } = await (await upload(c, fixture('mock-failure.pdf'))).json();
    await app.drain();
    const failed = await status(c, documentId);
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'analysis_unavailable', message: expect.any(String) } });
    const retry = await c.call(retryDoc, `/api/documents/${documentId}/retry`, { method: 'POST' }, { id: documentId });
    expect(retry.status).toBe(202);
    expect((await retry.json()).status).toBe('queued');
    expect(await app.drain()).toBe(3);
    expect((await status(c, documentId)).status).toBe('failed');

    const ok = await readyGuide(c);
    const conflict = await c.call(retryDoc, `/api/documents/${ok.documentId}/retry`, { method: 'POST' }, { id: ok.documentId });
    expect(conflict.status).toBe(409);
  }, 30_000);

  it('a job that ran out of attempts without finishing is reported as failed, not processing forever', async () => {
    const c = new TestClient();
    const { documentId } = await (await upload(c, fixture('lumen-bookcase.pdf'))).json();
    const job = (await app.ctx.queue.claim(1))!; // claimed, then the worker "dies"
    for (let i = job.attempts; i < job.maxAttempts; i++) {
      app.clock.now += 10;
      await app.ctx.queue.claim(1);
    }
    app.clock.now += 10;
    await app.ctx.queue.claim(1); // lease expired with no attempts left => failed
    expect(await status(c, documentId)).toMatchObject({ status: 'failed', error: { code: 'pipeline_failed' } });
  });
});

describe('files', () => {
  it('serves page images with private cache, nosniff, fixed type and sandbox CSP', async () => {
    const c = new TestClient();
    const { documentId } = await readyGuide(c);
    const res = await c.call(getImage, '/x', {}, { id: documentId, index: '0' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toMatch(/^private/);
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect((await c.call(getImage, '/x', {}, { id: documentId, index: '6' })).status).toBe(404);
    expect((await c.call(getImage, '/x', {}, { id: documentId, index: '-1' })).status).toBe(404);
    expect((await c.call(getImage, '/x', {}, { id: documentId, index: '../0' })).status).toBe(404);
  }, 30_000);

  it('photo pages are WebP; originals download unchanged as attachments', async () => {
    const c = new TestClient();
    const { documentId } = await readyGuide(c, lumenPages()[0]!);
    expect((await c.call(getImage, '/x', {}, { id: documentId, index: '0' })).headers.get('content-type')).toBe('image/webp');
    const pdfRes = await readyGuide(c);
    const orig = await c.call(getOriginal, `/api/documents/${pdfRes.documentId}/original`, {}, { id: pdfRes.documentId });
    expect(orig.headers.get('content-type')).toBe('application/pdf');
    expect(orig.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(orig.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await orig.arrayBuffer()).equals(fixture('lumen-bookcase.pdf'))).toBe(true);
  }, 30_000);
});

describe('guides', () => {
  it('lists documents newest first including processing and failed ones', async () => {
    const c = new TestClient();
    const ready = await readyGuide(c);
    app.clock.now += 1000;
    const failedUp = await (await upload(c, fixture('mock-failure.pdf'))).json();
    await app.drain();
    app.clock.now += 1000;
    const queued = await (await upload(c, fixture('not-a-manual.pdf'))).json();
    const list = await (await c.call(listGuides, '/api/guides')).json();
    expect(list.map((g: { documentId: string }) => g.documentId)).toEqual([queued.documentId, failedUp.documentId, ready.documentId]);
    expect(list.map((g: { status: string }) => g.status)).toEqual(['queued', 'failed', 'ready']);
    expect(list[2]).toMatchObject({
      id: ready.guideId, title: 'Lumen 3-shelf bookcase', stepCount: expect.any(Number), estimatedMinutes: 45,
      progress: { currentStepId: null, completedCount: 0, percent: 0 }, thumbnailPage: 0, updatedAt: expect.any(Number),
    });
    expect(list[0]).toMatchObject({ id: null, title: null, stepCount: 0 });
  }, 30_000);

  it('GET returns the validated guide, progress and page count', async () => {
    const c = new TestClient();
    const { guideId, documentId } = await readyGuide(c);
    const body = await (await c.call(getGuide, `/api/guides/${guideId}`, {}, { id: guideId })).json();
    expect(body).toMatchObject({ id: guideId, documentId, pageCount: 6, guide: { title: 'Lumen 3-shelf bookcase', schemaVersion: 1 } });
    expect(body.progress).toMatchObject({ currentStepId: null, completedStepIds: [], checklist: {} });
  }, 30_000);

  it('validates progress against the guide ids and persists it', async () => {
    const c = new TestClient();
    const { guideId } = await readyGuide(c);
    const guide = (await (await c.call(getGuide, '/x', {}, { id: guideId })).json()).guide;
    const [first, second] = Object.keys(guide.steps);
    const part = guide.parts[0].id;
    const put = (body: unknown) => c.call(putProgress, '/x', { method: 'PUT', body: JSON.stringify(body) }, { id: guideId });
    const good = { currentStepId: second, completedStepIds: [first, first], checklist: { [part]: 'have' } };
    const ok = await put(good);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ currentStepId: second, completedStepIds: [first], checklist: { [part]: 'have' } });
    expect((await (await c.call(getGuide, '/x', {}, { id: guideId })).json()).progress).toMatchObject({ currentStepId: second, completedStepIds: [first] });
    const list = await (await c.call(listGuides, '/x')).json();
    expect(list[0].progress).toMatchObject({ currentStepId: second, completedCount: 1 });
    expect(list[0].progress.percent).toBeGreaterThan(0);

    for (const bad of [
      { ...good, currentStepId: 'nope' },
      { ...good, currentStepId: 'constructor' },
      { ...good, completedStepIds: ['nope'] },
      { ...good, checklist: { nope: 'have' } },
      { ...good, checklist: { [part]: 'done' } },
      { currentStepId: 3, completedStepIds: [], checklist: {} },
      {},
    ]) {
      const res = await put(bad);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('invalid_request');
    }
    expect((await c.call(putProgress, '/x', { method: 'PUT', body: 'not json' }, { id: guideId })).status).toBe(400);
    // Failed writes changed nothing.
    expect((await (await c.call(getGuide, '/x', {}, { id: guideId })).json()).progress.currentStepId).toBe(second);
  }, 30_000);
});

describe('ownership: session B cannot see or change session A resources', () => {
  it('returns 404 for every route', async () => {
    const a = new TestClient();
    const b = new TestClient();
    const { documentId, guideId } = await readyGuide(a);
    await b.call(listGuides, '/x'); // B has its own session

    const p = { id: documentId };
    const g = { id: guideId };
    const results = await Promise.all([
      b.call(getDoc, '/x', {}, p),
      b.call(retryDoc, '/x', { method: 'POST' }, p),
      b.call(getImage, '/x', {}, { ...p, index: '0' }),
      b.call(getOriginal, '/x', {}, p),
      b.call(getGuide, '/x', {}, g),
      b.call(putProgress, '/x', { method: 'PUT', body: JSON.stringify({ currentStepId: null, completedStepIds: [], checklist: {} }) }, g),
      b.call(deleteGuide, '/x', { method: 'DELETE' }, g),
      b.call(deleteDoc, '/x', { method: 'DELETE' }, p),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(404));
    expect(await (await b.call(listGuides, '/x')).json()).toEqual([]);
    // A is untouched.
    expect((await status(a, documentId)).status).toBe('ready');
    expect((await a.call(getGuide, '/x', {}, g)).status).toBe(200);
  }, 30_000);

  it('malformed ids are 404, not errors', async () => {
    const c = new TestClient();
    expect((await c.call(getDoc, '/x', {}, { id: "1' OR '1'='1" })).status).toBe(404);
    expect((await c.call(getGuide, '/x', {}, { id: '../../etc/passwd' })).status).toBe(404);
  });
});

describe('DELETE', () => {
  it('deletes the guide, document and files; shared page images survive until the last user is gone', async () => {
    const c = new TestClient();
    const one = await readyGuide(c);
    const two = await readyGuide(c); // same content: shares analysis and page images
    const imgPath = async (id: string) => (await (await import('@/lib/db')).listPages(app.db, id))[0]!.imagePath;
    const shared = await imgPath(one.documentId);
    expect(await imgPath(two.documentId)).toBe(shared);

    const del = await c.call(deleteGuide, '/x', { method: 'DELETE' }, { id: one.guideId });
    expect(del.status).toBe(200);
    expect((await c.call(getGuide, '/x', {}, { id: one.guideId })).status).toBe(404);
    expect((await c.call(getDoc, '/x', {}, { id: one.documentId })).status).toBe(404);
    expect(await app.ctx.storage.exists(shared)).toBe(true); // still used by the other document
    expect((await c.call(getImage, '/x', {}, { id: two.documentId, index: '0' })).status).toBe(200);
    expect((await c.call(getGuide, '/x', {}, { id: two.guideId })).status).toBe(200); // shared analysis kept

    expect((await c.call(deleteGuide, '/x', { method: 'DELETE' }, { id: two.guideId })).status).toBe(200);
    expect(await app.ctx.storage.exists(shared)).toBe(false);
    const raw = (await import('better-sqlite3')).default;
    const sql = new raw(`${app.dir}/t.db`);
    expect(sql.prepare('select count(*) n from analyses').get()).toEqual({ n: 0 });
    expect(sql.prepare('select count(*) n from documents').get()).toEqual({ n: 0 });
    expect(sql.prepare('select count(*) n from pages').get()).toEqual({ n: 0 });
    expect(sql.prepare('select count(*) n from progress').get()).toEqual({ n: 0 });
    sql.close();
  }, 30_000);

  it('can remove a failed document that has no guide', async () => {
    const c = new TestClient();
    const { documentId } = await (await upload(c, fixture('mock-failure.pdf'))).json();
    await app.drain();
    expect((await c.call(deleteDoc, '/x', { method: 'DELETE' }, { id: documentId })).status).toBe(200);
    expect(await (await c.call(listGuides, '/x')).json()).toEqual([]);
  });
});
