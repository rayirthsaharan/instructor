import type { AnalysisKey, DocumentRecord, PagePanels } from '../db';
import {
  countPages, findAnalysis, findRenderedTwin, getPage, listPages, publishGuide, setPagePanels, upsertPage, type AnalysisRecord, type PageRecord,
} from '../db';
import type { AnalyseDocumentInput, PageImage } from '../ai/provider';
import { MAX_PAGES, PAGE_IMAGE_MAX_DIM, PIPELINE_VERSION } from '../limits';
import { CURRENT_SCHEMA_VERSION } from '../guide/schema';
import { validateGuide, type ValidatedGuide } from '../guide/validate';
import { normaliseImage } from '../render/image';
import { detectPanels, toStored } from '../render/panels';
import { probePdf, renderPdfPages } from '../render/pdf';
import { contentHashFor } from './hash';
import { PipelineError } from './errors';
import type { PipelineDeps, Report } from './types';

// Each stage is idempotent: it inspects what already exists and only does the missing work, so a resumed or
// retried job never repeats paid or expensive steps.

/** Analyses are shared globally only for real-provider PDFs; mock and photo-set results belong to one session. */
export function analysisKeyFor(deps: PipelineDeps, doc: DocumentRecord): AnalysisKey {
  const shared = !deps.provider.isMock && doc.kind === 'pdf';
  return {
    contentHash: doc.contentHash,
    pipelineVersion: PIPELINE_VERSION,
    provider: deps.provider.name,
    ownerSessionId: shared ? '' : doc.sessionId,
  };
}

async function readOriginals(deps: PipelineDeps, doc: DocumentRecord): Promise<Buffer[]> {
  try {
    return await Promise.all(doc.originalFiles.map((f) => deps.storage.get(f.key)));
  } catch {
    throw new PipelineError('corrupt_file', 'The uploaded file is no longer available. Please upload it again.');
  }
}

/** Stage 1. Verifies the stored original against its hash and finds an existing analysis to reuse (no provider calls). */
export async function ingestStage(deps: PipelineDeps, doc: DocumentRecord, report: Report): Promise<{ existing: AnalysisRecord | undefined }> {
  await report('ingest', 5);
  const files = await readOriginals(deps, doc);
  if (contentHashFor(doc.kind, files) !== doc.contentHash) {
    throw new PipelineError('corrupt_file', 'The stored file does not match what was uploaded. Please upload it again.');
  }
  const existing = await findAnalysis(deps.db, analysisKeyFor(deps, doc));
  return { existing };
}

const pageKey = (hash: string, index: number, ext: string) => `pages/${hash}/${index}.${ext}`;

async function pageIsComplete(deps: PipelineDeps, docId: string, index: number): Promise<boolean> {
  const p = await getPage(deps.db, docId, index);
  return p !== undefined && (await deps.storage.exists(p.imagePath));
}

/** Stage 2. Produces one stored image per page. Pages already rendered (or shared by identical content) are kept. */
export async function renderStage(deps: PipelineDeps, doc: DocumentRecord, report: Report, signal?: AbortSignal): Promise<PageRecord[]> {
  await report('render', 5);
  const probe = deps.probePdf ?? probePdf;
  let pageCount = doc.pageCount ?? undefined;
  const originals = await readOriginals(deps, doc);
  if (doc.kind === 'pdf') {
    // Page count is checked before any rasterising, whatever the database says.
    pageCount = (await probe(originals[0]!, deps.renderLimits)).pageCount;
  } else {
    pageCount = originals.length;
  }
  if (pageCount > MAX_PAGES) throw new PipelineError('too_many_pages', `This document has ${pageCount} pages. The limit is ${MAX_PAGES}.`);

  // Reuse the page images of identical content already rendered for another document.
  if ((await countPages(deps.db, doc.id)) < pageCount) {
    const twin = await findRenderedTwin(deps.db, doc.contentHash, doc.id);
    if (twin) {
      const theirs = await listPages(deps.db, twin);
      if ((await Promise.all(theirs.map((p) => deps.storage.exists(p.imagePath)))).every(Boolean)) {
        for (const p of theirs) await upsertPage(deps.db, { ...p, documentId: doc.id });
      }
    }
  }

  const missing: number[] = [];
  for (let i = 0; i < pageCount; i++) if (!(await pageIsComplete(deps, doc.id, i))) missing.push(i);
  const done = () => pageCount - missing.length;
  const progress = (n: number) => report('render', 5 + Math.round((35 * n) / pageCount));

  if (missing.length === 0) {
    /* every page already stored */
  } else if (doc.kind === 'pdf') {
    let rendered = done();
    await (deps.renderPdfPages ?? renderPdfPages)(
      originals[0]!,
      missing,
      async (p) => {
        if (signal?.aborted) throw new PipelineError('aborted', 'Cancelled', true);
        const key = pageKey(doc.contentHash, p.index, 'png');
        // Reference first, file second: a concurrent delete of an identical document then sees this reference and keeps the image.
        await upsertPage(deps.db, { documentId: doc.id, index: p.index, imagePath: key, width: p.width, height: p.height, textContent: p.text });
        await deps.storage.put(key, p.png);
        await progress(++rendered);
      },
      { maxDim: PAGE_IMAGE_MAX_DIM, ...deps.renderLimits },
    );
  } else {
    let rendered = done();
    for (const index of missing) {
      if (signal?.aborted) throw new PipelineError('aborted', 'Cancelled', true);
      const img = await normaliseImage(originals[index]!);
      const key = pageKey(doc.contentHash, index, img.ext);
      await upsertPage(deps.db, { documentId: doc.id, index, imagePath: key, width: img.width, height: img.height, textContent: null });
      await deps.storage.put(key, img.data);
      await progress(++rendered);
    }
  }

  const all = await listPages(deps.db, doc.id);
  const stored = await Promise.all(all.map((p) => deps.storage.exists(p.imagePath)));
  if (all.length !== pageCount || !stored.every(Boolean)) throw new PipelineError('render_failed', 'Some pages could not be prepared. Please try again.', true);
  return all;
}

/**
 * Stage 2b. Finds diagram panels on every page that has not been looked at yet (in code, on the stored page image) and
 * stores them. A page the detector cannot handle is logged and kept with zero panels: it never fails the document.
 */
export async function panelStage(deps: PipelineDeps, doc: DocumentRecord, pages: PageRecord[], report: Report, signal?: AbortSignal): Promise<PageRecord[]> {
  await report('render', 40);
  const detect = deps.detectPanels ?? detectPanels;
  const out: PageRecord[] = [];
  for (const page of pages) {
    if (page.panels) { out.push(page); continue; }
    if (signal?.aborted) throw new PipelineError('aborted', 'Cancelled', true);
    let found: PagePanels = { method: 'none', panels: [] };
    try {
      found = toStored(await detect(await deps.storage.get(page.imagePath), page.index));
    } catch (e) {
      console.error(`Pipeline: panel detection failed for document ${doc.id} page ${page.index}; continuing without panels`, e);
    }
    await setPagePanels(deps.db, doc.id, page.index, found);
    out.push({ ...page, panels: found });
  }
  return out;
}

/** Panels per page for the provider (pages with none are omitted) and for validation. */
export function panelsInput(pages: PageRecord[]): NonNullable<AnalyseDocumentInput['panels']> {
  return pages.filter((p) => p.panels && p.panels.panels.length > 0).map((p) => ({ pageIndex: p.index, panels: p.panels!.panels }));
}

export async function loadPageImages(deps: PipelineDeps, pages: PageRecord[]): Promise<PageImage[]> {
  return Promise.all(
    pages.map(async (p) => ({
      index: p.index,
      mimeType: (p.imagePath.endsWith('.webp') ? 'image/webp' : 'image/png') as PageImage['mimeType'],
      data: await deps.storage.get(p.imagePath),
    })),
  );
}

/** Page texts for quote checking; omitted entirely when no page has extractable text (scans, photos). */
export function pageTextsFor(pages: PageRecord[]): string[] | undefined {
  const texts = pages.map((p) => p.textContent ?? '');
  return texts.some((t) => t.trim() !== '') ? texts : undefined;
}

/** Only a ValidatedGuide leaves this function; anything the provider returned is untrusted until it passes. */
export function validateOrThrow(draft: unknown, pages: PageRecord[], what: string): ValidatedGuide {
  const panels = new Map(panelsInput(pages).map((p) => [p.pageIndex, p.panels] as const));
  const r = validateGuide(draft, { pageCount: pages.length, pageTexts: pageTextsFor(pages), panels });
  if (!r.ok) {
    console.error(`Pipeline: ${what} failed validation:`, r.errors.slice(0, 10).map((e) => `${e.path}: ${e.message}`).join('; '));
    throw new PipelineError('invalid_analysis', 'We could not build a reliable guide from this document, so we did not make one.');
  }
  return r.guide;
}

/** Stage 5. Writes the analysis, guide and progress rows and marks the document ready, in one transaction. */
export async function publishStage(deps: PipelineDeps, doc: DocumentRecord, guide: ValidatedGuide, pageCount: number, report: Report): Promise<string | undefined> {
  await report('publish', 90);
  const key = analysisKeyFor(deps, doc);
  const g = await publishGuide(
    deps.db,
    {
      documentId: doc.id,
      analysis: { ...key, sourceKind: doc.kind, guideJson: JSON.stringify(guide), schemaVersion: CURRENT_SCHEMA_VERSION, model: null },
      title: guide.title,
      pageCount,
    },
    deps.now(),
  );
  return g?.id;
}
