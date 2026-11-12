import { z } from 'zod';
import { applyProgressOps, getOwnedGuide, listLibrary, saveProgress, type OwnedGuide, type ProgressRecord } from '../db';
import { getOwn } from '../guide/selectors';
import { progressPercentage } from '../guide/selectors';
import { validateGuide, type ValidatedGuide } from '../guide/validate';
import type { AppContext, SessionInfo } from './context';
import { deleteOwnedDocument, documentView } from './documents';
import { ApiError, json, notFound, parseId, readJson } from './respond';

function readStoredGuide(owned: OwnedGuide): ValidatedGuide {
  const r = validateGuide(JSON.parse(owned.analysis.guideJson), { pageCount: owned.document.pageCount ?? 0 });
  if (!r.ok) throw new Error(`Stored guide ${owned.guide.id} no longer validates`);
  return r.guide;
}

const progressView = (p: ProgressRecord) => ({
  currentStepId: p.currentStepId,
  completedStepIds: p.completedStepIds,
  checklist: p.checklist,
  updatedAt: p.updatedAt,
});

async function ownedGuide(ctx: AppContext, session: SessionInfo, rawId: string): Promise<OwnedGuide> {
  const g = await getOwnedGuide(ctx.db, parseId(rawId), session.sessionId);
  if (!g) throw notFound('That guide');
  return g;
}

export async function listGuides(ctx: AppContext, session: SessionInfo): Promise<Response> {
  const rows = await listLibrary(ctx.db, session.sessionId);
  const out = [];
  for (const row of rows) {
    const view = await documentView(ctx, row.document);
    let stepCount = 0;
    let estimatedMinutes: number | null = null;
    let percent = 0;
    let currentStepTitle: string | null = null;
    if (row.guide && row.analysis && row.progress) {
      const guide = readStoredGuide({ guide: row.guide, document: row.document, analysis: row.analysis, progress: row.progress });
      stepCount = Object.keys(guide.steps).length;
      estimatedMinutes = guide.estimatedMinutes ?? null;
      percent = progressPercentage(guide, row.progress.completedStepIds);
      const cur = row.progress.currentStepId;
      currentStepTitle = (cur && getOwn(guide.steps, cur)?.title) || null;
    }
    out.push({
      id: row.guide?.id ?? null,
      documentId: row.document.id,
      title: row.guide?.title ?? null,
      stepCount,
      estimatedMinutes,
      progress: {
        currentStepId: row.progress?.currentStepId ?? null,
        currentStepTitle,
        completedCount: row.progress?.completedStepIds.length ?? 0,
        percent,
      },
      status: view.status,
      updatedAt: Math.max(row.document.createdAt, row.progress?.updatedAt ?? 0),
      thumbnailPage: 0,
    });
  }
  return json(out);
}

export async function getGuide(ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  const owned = await ownedGuide(ctx, session, rawId);
  return json({
    id: owned.guide.id,
    documentId: owned.document.id,
    guide: readStoredGuide(owned),
    progress: progressView(owned.progress),
    pageCount: owned.document.pageCount,
  });
}

const progressBody = z.object({
  currentStepId: z.string().max(100).nullable(),
  completedStepIds: z.array(z.string().max(100)).max(1000),
  checklist: z.record(z.string().max(100), z.enum(['unchecked', 'have', 'missing'])),
});

/** Rejects ids that are not part of the guide (nothing is saved). */
function assertIdsInGuide(
  guide: ValidatedGuide,
  ids: { currentStepId?: string | null; stepIds: string[]; checklistIds: string[] },
): void {
  const unknownStep = (id: string) => getOwn(guide.steps, id) === undefined;
  if (ids.currentStepId != null && unknownStep(ids.currentStepId)) throw new ApiError('invalid_request', 'The current step is not part of this guide.', 400);
  if (ids.stepIds.some(unknownStep)) throw new ApiError('invalid_request', 'A completed step is not part of this guide.', 400);
  const itemIds = new Set([...guide.parts.map((p) => p.id), ...guide.tools.map((t) => t.id)]);
  if (ids.checklistIds.some((k) => !itemIds.has(k))) throw new ApiError('invalid_request', 'A checklist item is not part of this guide.', 400);
}

/**
 * PUT replaces the whole progress record. Kept for tooling and test seeding; the app itself writes with PATCH,
 * because a whole-copy write from a stale tab erases what another tab saved (H-027).
 */
export async function putProgress(req: Request, ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  const owned = await ownedGuide(ctx, session, rawId);
  const parsed = progressBody.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError('invalid_request', 'The progress data is not in the expected shape.', 400);
  const guide = readStoredGuide(owned);
  const { currentStepId, completedStepIds, checklist } = parsed.data;
  assertIdsInGuide(guide, { currentStepId, stepIds: completedStepIds, checklistIds: Object.keys(checklist) });
  const saved = await saveProgress(
    ctx.db,
    owned.guide.id,
    { currentStepId, completedStepIds: [...new Set(completedStepIds)], checklist: { ...checklist } },
    ctx.now(),
  );
  if (!saved) throw notFound('That guide');
  return json(progressView(saved));
}

const progressOpsBody = z
  .object({
    complete: z.array(z.string().max(100)).max(1000).default([]),
    uncomplete: z.array(z.string().max(100)).max(1000).default([]),
    currentStepId: z.string().max(100).nullable().optional(),
    checklist: z.record(z.string().max(100), z.enum(['unchecked', 'have', 'missing'])).default({}),
  })
  .strict();

/**
 * PATCH applies operations to the current server state in one transaction, so writes from several tabs commute:
 * completing / un-completing are set operations on step ids, `currentStepId` and each checklist item are
 * last-writer-wins. Returns the merged progress.
 */
export async function patchProgress(req: Request, ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  const owned = await ownedGuide(ctx, session, rawId);
  const raw = await readJson(req);
  const parsed = progressOpsBody.safeParse(raw);
  if (!parsed.success) throw new ApiError('invalid_request', 'The progress data is not in the expected shape.', 400);
  const { complete, uncomplete, currentStepId, checklist } = parsed.data;
  const removing = new Set(uncomplete);
  if (complete.some((s) => removing.has(s))) throw new ApiError('invalid_request', 'A step cannot be completed and un-completed at once.', 400);
  const guide = readStoredGuide(owned);
  // Keys as sent (JSON.parse keeps an own "__proto__" key that schema parsing would silently drop).
  const sentChecklist = (raw as { checklist?: object }).checklist;
  const checklistIds = [...new Set([...Object.keys(checklist), ...(sentChecklist ? Object.keys(sentChecklist) : [])])];
  assertIdsInGuide(guide, { currentStepId, stepIds: [...complete, ...uncomplete], checklistIds });
  const saved = await applyProgressOps(
    ctx.db,
    owned.guide.id,
    { complete: [...new Set(complete)], uncomplete: [...removing], ...(currentStepId !== undefined && { currentStepId }), checklist },
    ctx.now(),
  );
  if (!saved) throw notFound('That guide');
  return json(progressView(saved));
}

export async function deleteGuide(ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  const owned = await ownedGuide(ctx, session, rawId);
  await deleteOwnedDocument(ctx, session, owned.document.id);
  return json({ deleted: true });
}
