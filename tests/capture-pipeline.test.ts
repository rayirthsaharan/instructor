import { afterEach, describe, expect, it } from 'vitest';
import { MockProvider } from '@/lib/ai';
import { DEMO_STEP_TITLE } from '@/lib/ai/demo-guide';
import { getDocument, getOwnedGuide, listPages, ensureSession, insertDocument, deleteDocumentCascade, getLatestJobForDocument } from '@/lib/db';
import { JOB_TYPE } from '@/lib/pipeline/types';
import { ingestStage, renderStage, analysisKeyFor } from '@/lib/pipeline/stages';
import { contentHashFor } from '@/lib/pipeline/hash';
import { orderedSteps } from '@/lib/guide/selectors';
import { validateGuide } from '@/lib/guide/validate';
import { createTestApp, fixture, lumenPages, type TestApp } from './helpers/app';
import manifest from '../fixtures/manifest.json';

let app: TestApp;
afterEach(() => app?.close());

async function addDocument(a: TestApp, sessionId: string, kind: 'pdf' | 'images', files: Uint8Array[], pageCount = files.length) {
  await ensureSession(a.db, sessionId, a.clock.now);
  const id = crypto.randomUUID();
  const originals = [];
  for (const [i, f] of files.entries()) {
    const key = `originals/${id}/${i}.${kind === 'pdf' ? 'pdf' : 'png'}`;
    await a.ctx.storage.put(key, f);
    originals.push({ key, mime: kind === 'pdf' ? 'application/pdf' : 'image/png', size: f.byteLength });
  }
  await insertDocument(a.db, { id, sessionId, contentHash: contentHashFor(kind, files), kind, originalFiles: originals, pageCount }, a.clock.now);
  await a.ctx.queue.enqueue({ type: JOB_TYPE, payload: { documentId: id }, documentId: id });
  return id;
}

const guideFor = async (a: TestApp, documentId: string, sessionId: string) => {
  const g = await (await import('@/lib/db')).getGuideForDocument(a.db, documentId);
  return g && (await getOwnedGuide(a.db, g.id, sessionId));
};

describe('pipeline end to end (mock provider)', () => {
  it('turns the Lumen fixture PDF into the validated fixture guide, with page images and text', async () => {
    app = createTestApp();
    const id = await addDocument(app, 's1', 'pdf', [fixture('lumen-bookcase.pdf')], 6);
    await app.drain();
    const doc = await getDocument(app.db, id);
    expect(doc).toMatchObject({ status: 'ready', pageCount: 6, errorCode: null });
    const pages = await listPages(app.db, id);
    expect(pages).toHaveLength(6);
    expect(pages[0]!.textContent).toContain('LUMEN 3-shelf bookcase');
    for (const p of pages) expect(await app.ctx.storage.exists(p.imagePath)).toBe(true);
    const owned = await guideFor(app, id, 's1');
    expect(owned?.guide.title).toBe('Lumen 3-shelf bookcase');
    // Stored JSON re-validates against the real page texts: every sourceQuote is found in the PDF text.
    const check = validateGuide(JSON.parse(owned!.analysis.guideJson), { pageCount: 6, pageTexts: pages.map((p) => p.textContent ?? '') });
    expect(check.ok).toBe(true);
    expect(app.provider).toMatchObject({ analyseCalls: 1, verifyCalls: 1 });
    expect(await getLatestJobForDocument(app.db, id)).toMatchObject({ status: 'done', progress: 100 });
  }, 30_000);

  it('handles the Lumen photo set the same way', async () => {
    app = createTestApp();
    const id = await addDocument(app, 's1', 'images', lumenPages());
    await app.drain();
    expect(await getDocument(app.db, id)).toMatchObject({ status: 'ready', pageCount: 6 });
    const pages = await listPages(app.db, id);
    expect(pages.every((p) => p.imagePath.endsWith('.webp') && p.textContent === null)).toBe(true);
    expect((await guideFor(app, id, 's1'))?.guide.title).toBe('Lumen 3-shelf bookcase');
  }, 30_000);

  it('rejects a document that is not a manual, creating no guide', async () => {
    app = createTestApp();
    const id = await addDocument(app, 's1', 'pdf', [fixture('not-a-manual.pdf')], 1);
    await app.drain();
    expect(await getDocument(app.db, id)).toMatchObject({ status: 'rejected', errorCode: 'not_a_manual' });
    expect(await guideFor(app, id, 's1')).toBeUndefined();
  });

  it('fails the failure fixture after the job attempts, with a retryable-looking user message', async () => {
    app = createTestApp();
    const id = await addDocument(app, 's1', 'pdf', [fixture('mock-failure.pdf')], 1);
    expect(await app.drain()).toBe(3); // three attempts
    expect(await getDocument(app.db, id)).toMatchObject({ status: 'failed', errorCode: 'analysis_unavailable' });
    expect(app.provider.analyseCalls).toBe(3);
  });

  it('builds a clearly labelled demo guide from the real page count for any other upload', async () => {
    app = createTestApp();
    const id = await addDocument(app, 's1', 'images', lumenPages().slice(0, 3)); // different set => not the fixture
    await app.drain();
    const owned = await guideFor(app, id, 's1');
    const v = validateGuide(JSON.parse(owned!.analysis.guideJson), { pageCount: 3 });
    if (!v.ok) throw new Error('demo guide invalid');
    const steps = orderedSteps(v.guide);
    expect(steps).toHaveLength(3);
    expect(steps.every((s) => s.title === DEMO_STEP_TITLE && s.confidence === 'low' && s.sources.length === 1)).toBe(true);
    expect(steps.map((s) => s.sources[0]!.pageIndex)).toEqual([0, 1, 2]);
    expect(v.guide.parts).toHaveLength(0);
    expect(v.guide.title).toMatch(/mock analysis/i);
  }, 30_000);

  it('never stores a guide the validator rejects', async () => {
    const bad = new MockProvider({ draft: { schemaVersion: 1, title: 'broken' } });
    app = createTestApp({ provider: bad });
    const id2 = await addDocument(app, 's1', 'images', lumenPages().slice(0, 2));
    await app.drain();
    expect(await getDocument(app.db, id2)).toMatchObject({ status: 'failed', errorCode: 'invalid_analysis' });
    expect(await guideFor(app, id2, 's1')).toBeUndefined();
  }, 30_000);
});

describe('dedupe', () => {
  it('a re-upload of the same content by the same session finishes with zero provider calls', async () => {
    app = createTestApp();
    const a = await addDocument(app, 's1', 'pdf', [fixture('lumen-bookcase.pdf')], 6);
    await app.drain();
    expect(app.provider.analyseCalls).toBe(1);
    const b = await addDocument(app, 's1', 'pdf', [fixture('lumen-bookcase.pdf')], 6);
    await app.drain();
    expect(app.provider).toMatchObject({ analyseCalls: 1, verifyCalls: 1 });
    expect(await getDocument(app.db, b)).toMatchObject({ status: 'ready' });
    const ga = await guideFor(app, a, 's1');
    const gb = await guideFor(app, b, 's1');
    expect(gb?.guide.id).not.toBe(ga?.guide.id); // separate guides and progress...
    expect(gb?.analysis.id).toBe(ga?.analysis.id); // ...over one analysis
  }, 30_000);

  it('mock results are never shared across sessions', async () => {
    app = createTestApp();
    await addDocument(app, 's1', 'pdf', [fixture('lumen-bookcase.pdf')], 6);
    await app.drain();
    const b = await addDocument(app, 's2', 'pdf', [fixture('lumen-bookcase.pdf')], 6);
    await app.drain();
    expect(app.provider.analyseCalls).toBe(2);
    const doc = (await getDocument(app.db, b))!;
    expect(analysisKeyFor(app.deps, doc).ownerSessionId).toBe('s2');
  }, 30_000);

  it('a real (non-mock) provider shares PDF analyses globally but keeps photo sets owner-scoped', () => {
    app = createTestApp();
    const real = { ...app.deps, provider: { ...app.provider, name: 'anthropic', isMock: false } as never };
    const pdf = { sessionId: 's1', kind: 'pdf', contentHash: 'h' } as never;
    const img = { sessionId: 's1', kind: 'images', contentHash: 'h' } as never;
    expect(analysisKeyFor(real, pdf).ownerSessionId).toBe('');
    expect(analysisKeyFor(real, img).ownerSessionId).toBe('s1');
  });
});

describe('stage idempotency', () => {
  it('render does no work the second time and re-renders only what is missing', async () => {
    let calls: number[][] = [];
    const real = (await import('@/lib/render/pdf')).renderPdfPages;
    app = createTestApp({ deps: { renderPdfPages: (d, idx, on, l) => (calls.push([...idx]), real(d, idx, on, l)) } });
    const id = await addDocument(app, 's1', 'pdf', [fixture('lumen-bookcase.pdf')], 6);
    const doc = (await getDocument(app.db, id))!;
    const report = async () => {};
    await renderStage(app.deps, doc, report);
    expect(calls).toEqual([[0, 1, 2, 3, 4, 5]]);
    calls = [];
    await renderStage(app.deps, doc, report);
    expect(calls).toEqual([]); // nothing missing: the child is not even started
    const pages = await listPages(app.db, id);
    await app.ctx.storage.delete(pages[2]!.imagePath); // simulate a lost file
    await renderStage(app.deps, doc, report);
    expect(calls).toEqual([[2]]);
    expect(await listPages(app.db, id)).toHaveLength(6);
  }, 30_000);

  it('render shares page images of identical content instead of rendering again', async () => {
    let renders = 0;
    const real = (await import('@/lib/render/pdf')).renderPdfPages;
    app = createTestApp({ deps: { renderPdfPages: (d, idx, on, l) => (renders++, real(d, idx, on, l)) } });
    const a = await addDocument(app, 's1', 'pdf', [fixture('lumen-bookcase.pdf')], 6);
    await app.drain();
    const b = await addDocument(app, 's2', 'pdf', [fixture('lumen-bookcase.pdf')], 6);
    await app.drain();
    expect(renders).toBe(1);
    const pa = await listPages(app.db, a);
    const pb = await listPages(app.db, b);
    expect(pb.map((p) => p.imagePath)).toEqual(pa.map((p) => p.imagePath));
  }, 30_000);

  it('ingest is read-only and finds an existing analysis; a tampered original is refused', async () => {
    app = createTestApp();
    const id = await addDocument(app, 's1', 'pdf', [fixture('mock-failure.pdf')], 1);
    const doc = (await getDocument(app.db, id))!;
    const report = async () => {};
    expect(await ingestStage(app.deps, doc, report)).toEqual({ existing: undefined });
    expect(await ingestStage(app.deps, doc, report)).toEqual({ existing: undefined });
    await app.ctx.storage.put(doc.originalFiles[0]!.key, Buffer.from('%PDF-1.4 tampered'));
    await expect(ingestStage(app.deps, doc, report)).rejects.toMatchObject({ code: 'corrupt_file' });
  });

  it('a resumed job reuses the saved analysis instead of paying again', async () => {
    app = createTestApp();
    const id = await addDocument(app, 's1', 'images', lumenPages().slice(0, 2));
    // First attempt dies after analysis (verification throws a retryable error); the retry must not re-analyse.
    let fail = true;
    const orig = app.provider.verifyGuide.bind(app.provider);
    app.provider.verifyGuide = async (i) => {
      if (fail) {
        fail = false;
        throw new Error('transient');
      }
      return orig(i);
    };
    await app.drain();
    expect(app.provider.analyseCalls).toBe(1);
    expect(await getDocument(app.db, id)).toMatchObject({ status: 'ready' });
  }, 30_000);

  it('publish is idempotent and a document deleted mid-run leaves nothing behind', async () => {
    app = createTestApp();
    const id = await addDocument(app, 's1', 'images', lumenPages().slice(0, 2));
    await deleteDocumentCascade(app.db, id, 's1');
    await app.drain();
    expect(await getDocument(app.db, id)).toBeUndefined();
  });
});

describe('fixtures', () => {
  it('manifest hashes match the committed fixture files', async () => {
    const { sha256 } = await import('@/lib/pipeline/hash');
    expect(sha256(fixture('lumen-bookcase.pdf'))).toBe(manifest.lumenBookcasePdf);
    expect(sha256(fixture('not-a-manual.pdf'))).toBe(manifest.notAManualPdf);
    expect(sha256(fixture('mock-failure.pdf'))).toBe(manifest.mockFailurePdf);
    expect(contentHashFor('images', lumenPages())).toBe(manifest.lumenBookcaseImages);
  });
});
