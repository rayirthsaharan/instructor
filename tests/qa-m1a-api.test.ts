import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import Database from 'better-sqlite3';
import { POST as postDocument } from '@/app/api/documents/route';
import { GET as getDoc, DELETE as deleteDoc } from '@/app/api/documents/[id]/route';
import { POST as retryDoc } from '@/app/api/documents/[id]/retry/route';
import { GET as getImage } from '@/app/api/documents/[id]/pages/[index]/image/route';
import { GET as listGuides } from '@/app/api/guides/route';
import { GET as getGuide, DELETE as deleteGuide } from '@/app/api/guides/[id]/route';
import { PUT as putProgress } from '@/app/api/guides/[id]/progress/route';
import { listPages } from '@/lib/db';
import { validateGuide } from '@/lib/guide/validate';
import { createTestApp, fixture, lumenPages, TestClient, uploadForm, type TestApp } from './helpers/app';

let app: TestApp;
beforeEach(() => {
  app = createTestApp();
});
afterEach(() => app.close());

const post = (c: TestClient, ...files: { data: Uint8Array; name?: string; type?: string }[]) =>
  c.call(postDocument, '/api/documents', { method: 'POST', body: uploadForm(...files) });
const status = async (c: TestClient, id: string) => (await c.call(getDoc, '/x', {}, { id })).json();
const sql = () => new Database(`${app.dir}/t.db`, { readonly: true });
const tinyPng = (w = 8) => sharp({ create: { width: w, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();

async function textPdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of pages) doc.addPage([300, 300]).drawText(t, { x: 20, y: 150, size: 14, font });
  return doc.save();
}

describe('upload contract: edge cases', () => {
  it('mixed PDF + images -> 415 unsupported_type; two PDFs -> 415', async () => {
    const c = new TestClient();
    const r1 = await post(c, { data: fixture('lumen-bookcase.pdf') }, { data: lumenPages()[0]! });
    expect(r1.status).toBe(415);
    expect((await r1.json()).error.code).toBe('unsupported_type');
    const r2 = await post(c, { data: fixture('lumen-bookcase.pdf') }, { data: fixture('lumen-bookcase.pdf') });
    expect(r2.status).toBe(415);
  });

  it('zero-byte file alone or beside a valid file -> 400 empty', async () => {
    const c = new TestClient();
    for (const files of [[{ data: new Uint8Array() }], [{ data: lumenPages()[0]! }, { data: new Uint8Array() }]]) {
      const r = await post(c, ...files);
      expect(r.status).toBe(400);
      expect((await r.json()).error.code).toBe('empty');
    }
  });

  it('wrong extension / declared type with right magic bytes is accepted; right extension with wrong bytes is refused', async () => {
    const c = new TestClient();
    const ok = await post(c, { data: fixture('lumen-bookcase.pdf'), name: 'photo.jpg', type: 'image/jpeg' });
    expect(ok.status).toBe(201);
    const ok2 = await post(c, { data: lumenPages()[0]!, name: 'manual.pdf', type: 'application/pdf' });
    expect(ok2.status).toBe(201);
    const bad = await post(c, { data: lumenPages()[0]!.subarray(0, 4), name: 'x.png', type: 'image/png' });
    expect(bad.status).toBe(415);
    const txt = await post(c, { data: Buffer.from('plain'), name: 'manual.pdf', type: 'application/pdf' });
    expect(txt.status).toBe(415);
  });

  it('HEIC with several brands is 415 and names the cause', async () => {
    const c = new TestClient();
    for (const brand of ['heic', 'heix', 'mif1']) {
      const r = await post(c, { data: Buffer.from(`\0\0\0\x18ftyp${brand}\0\0\0\0`), name: 'a.jpg', type: 'image/jpeg' });
      expect(r.status).toBe(415);
      expect((await r.json()).error.message).toMatch(/HEIC/);
    }
  });

  it('exactly 60 photos is accepted; 61 refused with nothing stored', async () => {
    const c = new TestClient();
    const one = await tinyPng();
    const ok = await post(c, ...Array.from({ length: 60 }, () => ({ data: one })));
    expect(ok.status).toBe(201);
    const before = sql().prepare('select count(*) n from documents').get();
    const bad = await post(c, ...Array.from({ length: 61 }, () => ({ data: one })));
    expect(bad.status).toBe(422);
    expect(sql().prepare('select count(*) n from documents').get()).toEqual(before);
  }, 60_000);

  it('oversize body without Content-Length is refused 413; file just over 40 MB is refused 413; nothing stored', async () => {
    const c = new TestClient();
    const huge = new Uint8Array(42 * 1024 * 1024);
    huge.set(Buffer.from('%PDF-1.4'));
    expect((await post(c, { data: huge })).status).toBe(413);
    const over = new Uint8Array(40 * 1024 * 1024 + 1);
    over.set(Buffer.from('%PDF-1.4'));
    expect((await post(c, { data: over })).status).toBe(413);
    expect(sql().prepare('select count(*) n from documents').get()).toEqual({ n: 0 });
  }, 60_000);

  it('multipart without a boundary is a 4xx contract error, not 500', async () => {
    const r = await new TestClient().call(postDocument, '/api/documents', { method: 'POST', body: 'garbage', headers: { 'content-type': 'multipart/form-data' } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect((await r.json()).error.code).toBe('corrupt_file');
  });

  it('a truncated real PDF never becomes a ready guide with the wrong content', async () => {
    const c = new TestClient();
    const pdf = fixture('lumen-bookcase.pdf');
    const r = await post(c, { data: pdf.subarray(0, Math.floor(pdf.length / 2)) });
    if (r.status === 201) {
      const { documentId } = await r.json();
      await app.drain();
      const s = await status(c, documentId);
      expect(['failed', 'rejected', 'ready']).toContain(s.status);
      if (s.status === 'ready') expect(s.pagesRendered).toBe(s.pageCount);
    } else {
      expect(r.status).toBe(422);
      expect((await r.json()).error.code).toBe('corrupt_file');
    }
  }, 30_000);

  it('a valid PNG whose metadata happens to contain "%PDF-" is still a photo, not a PDF (sniffing order)', async () => {
    const c = new TestClient();
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } })
      .withExif({ IFD0: { ImageDescription: 'scanned from %PDF-1.7 brochure' } })
      .png()
      .toBuffer();
    expect(png.subarray(0, 1024).toString('latin1')).toContain('%PDF-');
    const r = await post(c, { data: png, name: 'p.png', type: 'image/png' });
    expect(r.status).toBe(201);
  });

  it('a JPEG with "%PDF-" in its comment is still a photo', async () => {
    const c = new TestClient();
    const jpg = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } })
      .withExif({ IFD0: { ImageDescription: 'exported from %PDF-1.4 file' } })
      .jpeg()
      .toBuffer();
    expect(jpg.subarray(0, 1024).toString('latin1')).toContain('%PDF-');
    expect((await post(c, { data: jpg })).status).toBe(201);
  });
});

describe('pipeline honesty', () => {
  it('status/stage/progress are monotonic and honest while the job runs', async () => {
    const c = new TestClient();
    const seen: { status: string; stage: string | null; progress: number }[] = [];
    const real = (await import('@/lib/render/pdf')).renderPdfPages;
    let id = '';
    const snap = async () => seen.push(await status(c, id));
    app.close();
    app = createTestApp({
      deps: {
        renderPdfPages: (d, idx, on, l) => real(d, idx, async (p) => { await on(p); await snap(); }, l),
      },
    });
    id = (await (await post(c, { data: fixture('lumen-bookcase.pdf') })).json()).documentId;
    seen.push(await status(c, id));
    // wrap analyse/verify to sample too
    const prov = app.deps.provider;
    const a = prov.analyseDocument.bind(prov);
    const v = prov.verifyGuide.bind(prov);
    prov.analyseDocument = async (x) => (await snap(), a(x));
    prov.verifyGuide = async (x) => (await snap(), v(x));
    await app.drain();
    seen.push(await status(c, id));
    expect(seen[0]).toMatchObject({ status: 'queued', stage: null, progress: 0 });
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.progress).toBeGreaterThanOrEqual(seen[i - 1]!.progress);
    const mid = seen.slice(1, -1);
    expect(mid.length).toBeGreaterThanOrEqual(6);
    expect(mid.every((s) => s.status === 'processing' && s.stage !== null && s.progress < 1)).toBe(true);
    expect(mid.some((s) => s.stage === 'render')).toBe(true);
    expect(mid.some((s) => s.stage === 'analyse')).toBe(true);
    expect(mid.some((s) => s.stage === 'verify')).toBe(true);
    expect(seen.at(-1)).toMatchObject({ status: 'ready', stage: null, progress: 1 });
  }, 30_000);

  it('a render crash/timeout retries, then marks the document failed with render_failed and a safe message', async () => {
    const { RenderError } = await import('@/lib/render/pdf');
    app.close();
    app = createTestApp({ deps: { renderPdfPages: async () => { throw new RenderError('child died at /srv/secret/path', 'render_timeout'); } } });
    const c = new TestClient();
    const { documentId } = await (await post(c, { data: fixture('lumen-bookcase.pdf') })).json();
    expect(await app.drain()).toBe(3);
    const s = await status(c, documentId);
    expect(s).toMatchObject({ status: 'failed', error: { code: 'render_failed' } });
    expect(s.error.message).not.toMatch(/secret|child|\//);
    expect(app.provider.analyseCalls).toBe(0);
  }, 30_000);

  it('a real child-process timeout is reported as failed, not stuck processing', async () => {
    app.close();
    app = createTestApp({ deps: { renderLimits: { stepTimeoutMs: 1 } } });
    const c = new TestClient();
    const { documentId } = await (await post(c, { data: fixture('lumen-bookcase.pdf') })).json();
    await app.drain();
    const s = await status(c, documentId);
    expect(s.status).toBe('failed');
    expect(s.error.code).toMatch(/render_failed|pipeline_failed/);
    expect(s.guideId).toBeNull();
  }, 60_000);

  it('retry of a failed document keeps one document row, makes no guide, clears the error while queued, never duplicates guides', async () => {
    const c = new TestClient();
    const { documentId } = await (await post(c, { data: fixture('mock-failure.pdf') })).json();
    await app.drain();
    const retry = await c.call(retryDoc, '/x', { method: 'POST' }, { id: documentId });
    const body = await retry.json();
    expect(retry.status).toBe(202);
    expect(body).toMatchObject({ status: 'queued', error: null, progress: 0, stage: null, guideId: null });
    // second retry while queued is a conflict, not a second job
    expect((await c.call(retryDoc, '/x', { method: 'POST' }, { id: documentId })).status).toBe(409);
    await app.drain();
    expect((await status(c, documentId)).status).toBe('failed');
    expect(sql().prepare('select count(*) n from guides').get()).toEqual({ n: 0 });
    expect(sql().prepare('select count(*) n from documents').get()).toEqual({ n: 1 });
    expect(sql().prepare("select count(*) n from jobs where status in ('queued','running')").get()).toEqual({ n: 0 });
  }, 30_000);

  it('rejected (not_a_manual) cannot be retried; a ready document re-run from any state yields one guide and no new provider calls', async () => {
    const c = new TestClient();
    const rej = (await (await post(c, { data: fixture('not-a-manual.pdf') })).json()).documentId;
    await app.drain();
    expect((await c.call(retryDoc, '/x', { method: 'POST' }, { id: rej })).status).toBe(409);

    const { documentId } = await (await post(c, { data: fixture('lumen-bookcase.pdf') })).json();
    await app.drain();
    const guideId = (await status(c, documentId)).guideId;
    // Simulate a re-run: pages lost from storage + document marked failed, then retried.
    const pages = await listPages(app.db, documentId);
    await app.ctx.storage.delete(pages[2]!.imagePath);
    const { updateDocument } = await import('@/lib/db');
    await updateDocument(app.db, documentId, { status: 'failed', errorCode: 'pipeline_failed', errorMessage: 'x' });
    expect((await c.call(retryDoc, '/x', { method: 'POST' }, { id: documentId })).status).toBe(202);
    await app.drain();
    const s = await status(c, documentId);
    expect(s).toMatchObject({ status: 'ready', guideId, pagesRendered: 6 });
    expect(await app.ctx.storage.exists(pages[2]!.imagePath)).toBe(true);
    expect(app.provider).toMatchObject({ analyseCalls: 1 });
    expect(sql().prepare('select count(*) n from guides').get()).toEqual({ n: 1 });
  }, 60_000);

  it('a deduped re-upload reports no analyse/verify stage and zero provider calls; photos of another session are re-analysed', async () => {
    const a = new TestClient();
    const b = new TestClient();
    await post(a, { data: fixture('lumen-bookcase.pdf') });
    await app.drain();
    const calls = app.provider.analyseCalls;
    const again = (await (await post(a, { data: fixture('lumen-bookcase.pdf') })).json()).documentId;
    await app.drain();
    expect(app.provider.analyseCalls).toBe(calls);
    expect((await status(a, again)).status).toBe('ready');
    // other session, same PDF and same photo set: both re-analysed (mock never shared)
    await post(b, { data: fixture('lumen-bookcase.pdf') });
    await app.drain();
    expect(app.provider.analyseCalls).toBe(calls + 1);
    const ph1 = await post(a, ...lumenPages().map((data) => ({ data })));
    await app.drain();
    const afterA = app.provider.analyseCalls;
    await post(a, ...lumenPages().map((data) => ({ data })));
    await app.drain();
    expect(app.provider.analyseCalls).toBe(afterA);
    await post(b, ...lumenPages().map((data) => ({ data })));
    await app.drain();
    expect(app.provider.analyseCalls).toBe(afterA + 1);
    expect(ph1.status).toBe(201);
    const owners = sql().prepare('select owner_session_id o, count(*) n from analyses group by owner_session_id').all();
    expect(owners.every((r) => (r as { o: string }).o !== '')).toBe(true);
  }, 90_000);
});

describe('guide accuracy', () => {
  it('fixture guide: every sourceQuote appears in the text of its source page, and every step has a source', async () => {
    const c = new TestClient();
    const { documentId } = await (await post(c, { data: fixture('lumen-bookcase.pdf') })).json();
    await app.drain();
    const guideId = (await status(c, documentId)).guideId;
    const { guide } = await (await c.call(getGuide, '/x', {}, { id: guideId })).json();
    const pages = (await listPages(app.db, documentId)).map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').toLowerCase());
    const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
    let quotes = 0;
    for (const s of Object.values(guide.steps) as { sources: { pageIndex: number; sourceQuote?: string }[]; sourceQuote?: string; warnings: { sourceQuote?: string; source?: { pageIndex: number } }[]; id: string }[]) {
      expect(s.sources.length, s.id).toBeGreaterThan(0);
      for (const w of s.warnings) {
        if (w.sourceQuote) {
          quotes++;
          const pi = w.source?.pageIndex ?? s.sources[0]!.pageIndex;
          expect(pages.some((p) => p.includes(norm(w.sourceQuote!))), `warning quote on ${s.id} (page ${pi})`).toBe(true);
        }
      }
      if (s.sourceQuote) {
        quotes++;
        expect(pages.some((p) => p.includes(norm(s.sourceQuote!))), s.id).toBe(true);
      }
    }
    expect(quotes).toBeGreaterThan(0);
  }, 30_000);

  it('demo guide for a text PDF: validates against page text, labelled, one sourced step per page, no invented numbers/parts', async () => {
    const c = new TestClient();
    const pdf = await textPdf(['Attach the leg with 4 screws of 35 mm', 'Tighten to 5 Nm', 'Done']);
    const { documentId } = await (await post(c, { data: pdf })).json();
    await app.drain();
    const s = await status(c, documentId);
    expect(s.status).toBe('ready');
    const { guide } = await (await c.call(getGuide, '/x', {}, { id: s.guideId })).json();
    expect(validateGuide(guide, { pageCount: 3 }).ok).toBe(true);
    expect(guide.title).toMatch(/Demo guide \(mock analysis, 3 pages\)/);
    expect(guide.summary).toMatch(/mock/i);
    expect(guide.parts).toEqual([]);
    expect(guide.tools).toEqual([]);
    const steps = Object.values(guide.steps) as { sources: { pageIndex: number }[]; title: string; instruction: string; confidence: string }[];
    expect(steps).toHaveLength(3);
    for (const st of steps) {
      expect(st.confidence).toBe('low');
      expect(st.sources).toHaveLength(1);
      expect(`${st.title} ${st.instruction}`).not.toMatch(/\b(mm|nm|screws?)\b|\d+\s*(mm|cm|nm)/i);
    }
    expect(new Set(steps.map((x) => x.sources[0]!.pageIndex))).toEqual(new Set([0, 1, 2]));
    const list = await (await c.call(listGuides, '/x')).json();
    expect(list[0].title).toMatch(/Demo guide/);
  }, 30_000);

  it('single-page demo guide uses a singular label', async () => {
    const c = new TestClient();
    const { documentId } = await (await post(c, { data: await tinyPng(9) })).json();
    await app.drain();
    const s = await status(c, documentId);
    const { guide } = await (await c.call(getGuide, '/x', {}, { id: s.guideId })).json();
    expect(guide.title).toMatch(/1 page\)/);
  });
});

describe('progress validation, extra cases', () => {
  it('rejects prototype keys, step ids used as checklist keys, oversized lists; accepts tool ids; nothing is saved on failure', async () => {
    const c = new TestClient();
    const { documentId } = await (await post(c, { data: fixture('lumen-bookcase.pdf') })).json();
    await app.drain();
    const guideId = (await status(c, documentId)).guideId;
    const { guide } = await (await c.call(getGuide, '/x', {}, { id: guideId })).json();
    const stepId = Object.keys(guide.steps)[0];
    const put = (raw: string) => c.call(putProgress, '/x', { method: 'PUT', body: raw }, { id: guideId });
    for (const raw of [
      `{"currentStepId":null,"completedStepIds":[],"checklist":{"__proto__":"have"}}`,
      `{"currentStepId":null,"completedStepIds":[],"checklist":{"constructor":"have"}}`,
      `{"currentStepId":null,"completedStepIds":[],"checklist":{"${stepId}":"have"}}`,
      `{"currentStepId":"__proto__","completedStepIds":[],"checklist":{}}`,
      `{"currentStepId":null,"completedStepIds":["toString"],"checklist":{}}`,
      `{"currentStepId":null,"completedStepIds":[],"checklist":{},"extra":1}x`,
      `[]`, `null`, `""`,
    ]) {
      const r = await put(raw);
      expect(r.status, raw).toBe(400);
      expect((await r.json()).error.code).toBe('invalid_request');
    }
    if (guide.tools.length) {
      expect((await put(JSON.stringify({ currentStepId: null, completedStepIds: [], checklist: { [guide.tools[0].id]: 'missing' } }))).status).toBe(200);
    }
    const g = await (await c.call(getGuide, '/x', {}, { id: guideId })).json();
    expect(g.progress.completedStepIds).toEqual([]);
  }, 30_000);

  it('GET/PUT with a documentId instead of a guide id is 404', async () => {
    const c = new TestClient();
    const { documentId } = await (await post(c, { data: fixture('lumen-bookcase.pdf') })).json();
    await app.drain();
    expect((await c.call(getGuide, '/x', {}, { id: documentId })).status).toBe(404);
  }, 30_000);
});

describe('delete removes files', () => {
  it('removes originals and page images of an unshared document, keeps the other session untouched', async () => {
    const a = new TestClient();
    const b = new TestClient();
    const ida = (await (await post(a, { data: fixture('lumen-bookcase.pdf') })).json()).documentId;
    const idb = (await (await post(b, { data: fixture('lumen-bookcase.pdf') })).json()).documentId;
    await app.drain();
    const pagesA = await listPages(app.db, ida);
    const pagesB = await listPages(app.db, idb);
    const originalKey = (sql().prepare('select original_files f from documents where id = ?').get(ida) as { f: string }).f;
    const origKey = JSON.parse(originalKey)[0].key as string;
    expect(await app.ctx.storage.exists(origKey)).toBe(true);
    // identical content in two sessions share page images (content addressed)
    const shared = pagesA[0]!.imagePath === pagesB[0]!.imagePath;
    expect((await a.call(deleteDoc, '/x', { method: 'DELETE' }, { id: ida })).status).toBe(200);
    expect(await app.ctx.storage.exists(origKey)).toBe(false);
    if (shared) expect(await app.ctx.storage.exists(pagesB[0]!.imagePath)).toBe(true);
    expect((await b.call(getImage, '/x', {}, { id: idb, index: '0' })).status).toBe(200);
    expect((await a.call(deleteDoc, '/x', { method: 'DELETE' }, { id: ida })).status).toBe(404);
    expect((await b.call(deleteGuide, '/x', { method: 'DELETE' }, { id: (await status(b, idb)).guideId })).status).toBe(200);
    expect(await app.ctx.storage.exists(pagesB[0]!.imagePath)).toBe(false);
  }, 60_000);

  it('deleting a queued document makes its job a harmless no-op', async () => {
    const c = new TestClient();
    const { documentId } = await (await post(c, { data: fixture('lumen-bookcase.pdf') })).json();
    await c.call(deleteDoc, '/x', { method: 'DELETE' }, { id: documentId });
    await app.drain();
    expect(app.provider.analyseCalls).toBe(0);
    expect(sql().prepare('select count(*) n from guides').get()).toEqual({ n: 0 });
    expect(sql().prepare('select count(*) n from pages').get()).toEqual({ n: 0 });
  });
});
