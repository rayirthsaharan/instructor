import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@/lib/ai';
import type { AnalyseDocumentInput } from '@/lib/ai/provider';
import {
  deleteDocumentCascade, ensureSession, getDocument, getGuideForDocument, getOwnedGuide, getPage, insertDocument, listPages, setPagePanels, upsertPage,
} from '@/lib/db';
import { resolveRef } from '@/lib/guide/panel-refs';
import { validateGuide } from '@/lib/guide/validate';
import { contentHashFor } from '@/lib/pipeline/hash';
import { JOB_TYPE } from '@/lib/pipeline/types';
import { detectPanels } from '@/lib/render/panels';
import { createTestApp, fixture, type TestApp } from './helpers/app';
import fixtureGuide from '../fixtures/lumen-bookcase.guide.json';

let app: TestApp;
afterEach(() => app?.close());

async function addPdf(a: TestApp, sessionId: string) {
  await ensureSession(a.db, sessionId, a.clock.now);
  const id = crypto.randomUUID();
  const file = fixture('lumen-bookcase.pdf');
  const key = `originals/${id}/0.pdf`;
  await a.ctx.storage.put(key, file);
  await insertDocument(a.db, { id, sessionId, contentHash: contentHashFor('pdf', [file]), kind: 'pdf', originalFiles: [{ key, mime: 'application/pdf', size: file.byteLength }], pageCount: 6 }, a.clock.now);
  await a.ctx.queue.enqueue({ type: JOB_TYPE, payload: { documentId: id }, documentId: id });
  return id;
}

class SpyProvider extends MockProvider {
  inputs: AnalyseDocumentInput[] = [];
  override analyseDocument(input: AnalyseDocumentInput) {
    this.inputs.push(input);
    return super.analyseDocument(input);
  }
}

const guideOf = async (a: TestApp, id: string, sessionId: string) => JSON.parse((await getOwnedGuide(a.db, (await getGuideForDocument(a.db, id))!.id, sessionId))!.analysis.guideJson);

describe('panel detection in the pipeline (Lumen PDF, mock provider)', () => {
  it('stores panels per page, offers them to the provider and keeps the fixture crops', async () => {
    const spy = new SpyProvider();
    app = createTestApp({ provider: spy });
    const id = await addPdf(app, 's1');
    await app.drain();
    expect(await getDocument(app.db, id)).toMatchObject({ status: 'ready' });

    const pages = await listPages(app.db, id);
    expect(pages[2]!.panels).toMatchObject({ method: 'frames' });
    expect(pages[2]!.panels!.panels.map((p) => p.panelId)).toEqual(['p3-a', 'p3-b']);
    expect(pages[1]!.panels!.panels).toHaveLength(9);

    // The provider got the same lists (pages without panels are left out).
    const offered = spy.inputs[0]!.panels!;
    expect(offered.find((p) => p.pageIndex === 2)!.panels.map((p) => p.panelId)).toEqual(['p3-a', 'p3-b']);

    // Crops: each step source with a fixture panel now carries the detected panel region, which contains the fixture region.
    const guide = await guideOf(app, id, 's1');
    const fixtureSteps = (fixtureGuide as unknown as { steps: Record<string, { sources: { panelId?: string; region?: { x: number; y: number; w: number; h: number } }[] }> }).steps;
    let checked = 0;
    for (const [sid, step] of Object.entries(fixtureSteps)) {
      step.sources.forEach((fixtureSrc, i) => {
        if (!fixtureSrc.panelId || !fixtureSrc.region) return;
        const src = guide.steps[sid].sources[i];
        const f = fixtureSrc.region;
        expect(src, sid).toMatchObject({ panelId: fixtureSrc.panelId, regionFallback: false });
        expect(src.region.x, sid).toBeLessThanOrEqual(f.x + 1e-6);
        expect(src.region.y, sid).toBeLessThanOrEqual(f.y + 1e-6);
        expect(src.region.x + src.region.w, sid).toBeGreaterThanOrEqual(f.x + f.w - 1e-6);
        expect(src.region.y + src.region.h, sid).toBeGreaterThanOrEqual(f.y + f.h - 1e-6);
        checked++;
      });
    }
    expect(checked).toBe(9);
    // Whole-page sources stay whole-page.
    expect(guide.steps.s1.sources[0]).toEqual({ pageIndex: 0, regionFallback: true });
    expect(validateGuide(guide, { pageCount: 6 }).ok).toBe(true);
  }, 60_000);

  it('a detector failure on a page does not fail the document: no panels, whole-page sources flagged approximate', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    app = createTestApp({ deps: { detectPanels: async () => { throw new Error('boom'); } } });
    const id = await addPdf(app, 's1');
    await app.drain();
    expect(await getDocument(app.db, id)).toMatchObject({ status: 'ready' });
    expect((await listPages(app.db, id)).every((p) => p.panels?.method === 'none' && p.panels.panels.length === 0)).toBe(true);
    const guide = await guideOf(app, id, 's1');
    for (const step of Object.values(guide.steps) as { sources: object[] }[]) {
      for (const s of step.sources) expect(s).toMatchObject({ regionFallback: true });
      for (const s of step.sources) expect(s).not.toHaveProperty('region');
      for (const s of step.sources) expect(s).not.toHaveProperty('panelId');
    }
    spy.mockRestore();
  }, 60_000);

  it('detects once per page: an identical upload reuses the stored panels', async () => {
    const counting = vi.fn(detectPanels);
    app = createTestApp({ deps: { detectPanels: counting } });
    const first = await addPdf(app, 's1');
    await app.drain();
    expect(counting).toHaveBeenCalledTimes(6);
    const second = await addPdf(app, 's2');
    await app.drain();
    expect(await getDocument(app.db, second)).toMatchObject({ status: 'ready' });
    expect(counting).toHaveBeenCalledTimes(6);
    expect((await listPages(app.db, second))[2]!.panels).toEqual((await listPages(app.db, first))[2]!.panels);
    await deleteDocumentCascade(app.db, first, 's1');
  }, 60_000);
});

describe('page panel storage', () => {
  it('round-trips, resets with a new image, and reads corrupt JSON as "not detected"', async () => {
    app = createTestApp();
    await ensureSession(app.db, 's1', app.clock.now);
    const id = crypto.randomUUID();
    await insertDocument(app.db, { id, sessionId: 's1', contentHash: 'h'.repeat(64), kind: 'images', originalFiles: [{ key: 'o/0.png', mime: 'image/png', size: 1 }], pageCount: 1 }, app.clock.now);
    const page = { documentId: id, index: 0, imagePath: 'pages/x/0.png', width: 10, height: 10, textContent: null };
    await upsertPage(app.db, page);
    expect((await getPage(app.db, id, 0))!.panels).toBeNull();
    const found = { method: 'xycut' as const, panels: [{ panelId: 'p1-a', region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }] };
    await setPagePanels(app.db, id, 0, found);
    expect((await getPage(app.db, id, 0))!.panels).toEqual(found);
    await upsertPage(app.db, { ...page, imagePath: 'pages/y/0.png' });
    expect((await getPage(app.db, id, 0))!.panels).toBeNull();
    const { pages } = await import('@/lib/db/schema');
    const { unwrap } = await import('@/lib/db/client');
    unwrap(app.db).update(pages).set({ panelsJson: '{"method":"frames","panels":[{"panelId":1}]}' }).run();
    expect((await getPage(app.db, id, 0))!.panels).toBeNull();
  });
});

describe('resolving model-chosen panel ids (validation)', () => {
  const panels = new Map([[0, [{ panelId: 'p1-a', region: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 } }]]]);
  const base = () => structuredClone(fixtureGuide) as unknown as { steps: Record<string, { sources: unknown[]; highlights: { source: unknown }[] }>; parts: { source: unknown }[] };
  const setSource = (ref: unknown) => { const g = base(); g.steps.s2!.sources = [ref]; return g; };
  const run = (ref: unknown) => {
    const r = validateGuide(setSource(ref), { pageCount: 6, panels });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.guide.steps.s2!.sources[0]!;
  };

  it('takes the stored region for a known panel, ignoring whatever region the model wrote', () => {
    expect(run({ pageIndex: 0, panelId: 'p1-a', region: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 } })).toEqual({ pageIndex: 0, panelId: 'p1-a', region: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }, regionFallback: false });
  });

  it('turns an unknown id, a missing id, or a page without panels into the whole page, flagged', () => {
    const box = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
    expect(run({ pageIndex: 0, panelId: 'p9-z', region: box })).toEqual({ pageIndex: 0, regionFallback: true });
    expect(run({ pageIndex: 0, region: box })).toEqual({ pageIndex: 0, regionFallback: true });
    expect(run({ pageIndex: 3, panelId: 'p1-a', region: box })).toEqual({ pageIndex: 3, regionFallback: true });
    expect(run({ pageIndex: 0, regionFallback: false })).toEqual({ pageIndex: 0, regionFallback: true });
  });

  it('keeps a highlight inside its panel, and uses the panel when the highlight lies outside it', () => {
    const inside = { x: 0.2, y: 0.3, w: 0.1, h: 0.1 };
    expect(resolveRef({ pageIndex: 0, panelId: 'p1-a', region: inside, regionFallback: false }, panels, true).region).toEqual(inside);
    expect(resolveRef({ pageIndex: 0, panelId: 'p1-a', region: { x: 0.7, y: 0.7, w: 0.2, h: 0.2 }, regionFallback: false }, panels, true).region).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
  });

  it('resolves parts, tools and glossary sources too, and leaves guides alone when no panel list is given', () => {
    const r = validateGuide(base(), { pageCount: 6, panels });
    if (!r.ok) throw new Error('invalid');
    expect(r.guide.parts.every((p) => p.source.regionFallback)).toBe(true); // the fixture's parts sit on page 2, which has no panels in this list
    expect(r.issues.some((i) => i.code === 'panel_fallback')).toBe(true);
    const untouched = validateGuide(base(), { pageCount: 6 });
    if (!untouched.ok) throw new Error('invalid');
    expect(untouched.guide.steps.s2!.sources[0]).toMatchObject({ panelId: 'p3-a', region: { x: 0.05, y: 0.14, w: 0.9, h: 0.38 } });
  });
});
