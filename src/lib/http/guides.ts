import { z } from 'zod';
import { getOwnedGuide, listLibrary, saveProgress, type OwnedGuide, type ProgressRecord } from '../db';
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

export async function putProgress(req: Request, ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  const owned = await ownedGuide(ctx, session, rawId);
  const parsed = progressBody.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError('invalid_request', 'The progress data is not in the expected shape.', 400);
  const guide = readStoredGuide(owned);
  const { currentStepId, completedStepIds, checklist } = parsed.data;
  const unknownStep = (id: string) => getOwn(guide.steps, id) === undefined;
  if (currentStepId !== null && unknownStep(currentStepId)) throw new ApiError('invalid_request', 'The current step is not part of this guide.', 400);
  if (completedStepIds.some(unknownStep)) throw new ApiError('invalid_request', 'A completed step is not part of this guide.', 400);
  const itemIds = new Set([...guide.parts.map((p) => p.id), ...guide.tools.map((t) => t.id)]);
  if (Object.keys(checklist).some((k) => !itemIds.has(k))) throw new ApiError('invalid_request', 'A checklist item is not part of this guide.', 400);
  const saved = await saveProgress(
    ctx.db,
    owned.guide.id,
    { currentStepId, completedStepIds: [...new Set(completedStepIds)], checklist: { ...checklist } },
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
