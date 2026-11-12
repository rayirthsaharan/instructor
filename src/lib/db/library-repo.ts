import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { unwrap, type Db } from './client';
import {
  analyses, documents, guides, jobArtifacts, jobs, messages, pages, progress, rateLimits, sessions, simplifications, stepNotes,
} from './schema';

// Repository for the capture/analysis/library features. All SQL for these tables lives here (D-010).

export type DocumentStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'rejected';
export type DocumentKind = 'pdf' | 'images';

export interface OriginalFile {
  key: string;
  mime: string;
  size: number;
}

export interface DocumentRecord {
  id: string;
  sessionId: string;
  contentHash: string;
  kind: DocumentKind;
  originalPath: string;
  originalFiles: OriginalFile[];
  pageCount: number | null;
  status: DocumentStatus;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: number;
}

type DocRow = typeof documents.$inferSelect;
const toDoc = (r: DocRow): DocumentRecord => ({
  id: r.id,
  sessionId: r.sessionId,
  contentHash: r.contentHash,
  kind: r.kind,
  originalPath: r.originalPath,
  originalFiles: JSON.parse(r.originalFilesJson) as OriginalFile[],
  pageCount: r.pageCount,
  status: r.status as DocumentStatus,
  errorCode: r.errorCode,
  errorMessage: r.errorMessage,
  retryCount: r.retryCount,
  createdAt: r.createdAt,
});

// --- sessions ---------------------------------------------------------------------------------

export async function ensureSession(db: Db, id: string, now: number): Promise<void> {
  unwrap(db).insert(sessions).values({ id, createdAt: now }).onConflictDoNothing().run();
}

export async function sessionExists(db: Db, id: string): Promise<boolean> {
  return unwrap(db).select({ id: sessions.id }).from(sessions).where(eq(sessions.id, id)).get() !== undefined;
}

// --- documents --------------------------------------------------------------------------------

export interface NewDocument {
  id?: string;
  sessionId: string;
  contentHash: string;
  kind: DocumentKind;
  originalFiles: OriginalFile[];
  pageCount?: number | null;
}

export async function insertDocument(db: Db, input: NewDocument, now: number): Promise<DocumentRecord> {
  const first = input.originalFiles[0];
  if (!first) throw new Error('A document needs at least one original file');
  const row: DocRow = {
    id: input.id ?? randomUUID(),
    sessionId: input.sessionId,
    contentHash: input.contentHash,
    kind: input.kind,
    originalPath: first.key,
    originalFilesJson: JSON.stringify(input.originalFiles),
    pageCount: input.pageCount ?? null,
    status: 'queued',
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: now,
  };
  unwrap(db).insert(documents).values(row).run();
  return toDoc(row);
}

export async function getDocument(db: Db, id: string): Promise<DocumentRecord | undefined> {
  const r = unwrap(db).select().from(documents).where(eq(documents.id, id)).get();
  return r && toDoc(r);
}

/** Session-scoped read: another session's document is indistinguishable from a missing one. */
export async function getOwnedDocument(db: Db, id: string, sessionId: string): Promise<DocumentRecord | undefined> {
  const r = unwrap(db).select().from(documents).where(and(eq(documents.id, id), eq(documents.sessionId, sessionId))).get();
  return r && toDoc(r);
}

export interface DocumentPatch {
  status?: DocumentStatus;
  pageCount?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export async function updateDocument(db: Db, id: string, patch: DocumentPatch): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  unwrap(db).update(documents).set(patch).where(eq(documents.id, id)).run();
}

/** Puts a failed document back in the queue (clears the error). Returns false if it was not failed. */
export async function requeueFailedDocument(db: Db, id: string): Promise<boolean> {
  const res = unwrap(db)
    .update(documents)
    .set({ status: 'queued', errorCode: null, errorMessage: null, retryCount: sql`${documents.retryCount} + 1` })
    .where(and(eq(documents.id, id), eq(documents.status, 'failed')))
    .run();
  return res.changes > 0;
}

export async function getLatestJobForDocument(db: Db, documentId: string) {
  const r = unwrap(db).select().from(jobs).where(eq(jobs.documentId, documentId)).orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(1).get();
  return r && { id: r.id, status: r.status, stage: r.stage, progress: r.progress, error: r.error, attempts: r.attempts, maxAttempts: r.maxAttempts };
}

// --- pages ------------------------------------------------------------------------------------

export interface PageRecord {
  documentId: string;
  index: number;
  imagePath: string;
  width: number;
  height: number;
  textContent: string | null;
}

const toPage = (r: typeof pages.$inferSelect): PageRecord => ({
  documentId: r.documentId, index: r.index, imagePath: r.imagePath, width: r.width, height: r.height, textContent: r.textContent,
});

export async function listPages(db: Db, documentId: string): Promise<PageRecord[]> {
  return unwrap(db).select().from(pages).where(eq(pages.documentId, documentId)).orderBy(pages.index).all().map(toPage);
}

export async function countPages(db: Db, documentId: string): Promise<number> {
  const r = unwrap(db).select({ n: sql<number>`count(*)` }).from(pages).where(eq(pages.documentId, documentId)).get();
  return r?.n ?? 0;
}

export async function getPage(db: Db, documentId: string, index: number): Promise<PageRecord | undefined> {
  const r = unwrap(db).select().from(pages).where(and(eq(pages.documentId, documentId), eq(pages.index, index))).get();
  return r && toPage(r);
}

/** Idempotent: re-writing the same page replaces its row. */
export async function upsertPage(db: Db, p: PageRecord): Promise<void> {
  unwrap(db)
    .insert(pages)
    .values({ id: randomUUID(), documentId: p.documentId, index: p.index, imagePath: p.imagePath, width: p.width, height: p.height, textContent: p.textContent })
    .onConflictDoUpdate({
      target: [pages.documentId, pages.index],
      set: { imagePath: p.imagePath, width: p.width, height: p.height, textContent: p.textContent },
    })
    .run();
}

/** Another document with identical content whose pages are all rendered (page images can be shared). */
export async function findRenderedTwin(db: Db, contentHash: string, excludeId: string): Promise<string | undefined> {
  const rows = unwrap(db)
    .select({ id: documents.id, pageCount: documents.pageCount })
    .from(documents)
    .where(and(eq(documents.contentHash, contentHash), ne(documents.id, excludeId)))
    .all();
  for (const r of rows) {
    if (r.pageCount !== null && (await countPages(db, r.id)) === r.pageCount) return r.id;
  }
  return undefined;
}

// --- analyses ---------------------------------------------------------------------------------

export interface AnalysisKey {
  contentHash: string;
  pipelineVersion: string;
  provider: string;
  /** '' = globally shareable. */
  ownerSessionId: string;
}

export interface AnalysisRecord extends AnalysisKey {
  id: string;
  sourceKind: DocumentKind;
  guideJson: string;
  schemaVersion: number;
  model: string | null;
}

const keyWhere = (k: AnalysisKey) =>
  and(
    eq(analyses.contentHash, k.contentHash),
    eq(analyses.pipelineVersion, k.pipelineVersion),
    eq(analyses.provider, k.provider),
    eq(analyses.ownerSessionId, k.ownerSessionId),
  );

const toAnalysis = (r: typeof analyses.$inferSelect): AnalysisRecord => ({
  id: r.id, contentHash: r.contentHash, pipelineVersion: r.pipelineVersion, provider: r.provider, ownerSessionId: r.ownerSessionId,
  sourceKind: r.sourceKind, guideJson: r.guideJson, schemaVersion: r.schemaVersion, model: r.model,
});

export async function findAnalysis(db: Db, key: AnalysisKey): Promise<AnalysisRecord | undefined> {
  const r = unwrap(db).select().from(analyses).where(keyWhere(key)).get();
  return r && toAnalysis(r);
}

/** Immutable rows: an existing row for the key is returned unchanged. */
export async function insertAnalysis(
  db: Db,
  input: AnalysisKey & { sourceKind: DocumentKind; guideJson: string; schemaVersion: number; model?: string | null },
  now: number,
): Promise<AnalysisRecord> {
  const inner = unwrap(db);
  inner
    .insert(analyses)
    .values({
      id: randomUUID(), contentHash: input.contentHash, pipelineVersion: input.pipelineVersion, provider: input.provider,
      sourceKind: input.sourceKind, ownerSessionId: input.ownerSessionId, guideJson: input.guideJson,
      schemaVersion: input.schemaVersion, model: input.model ?? null, createdAt: now,
    })
    .onConflictDoNothing()
    .run();
  const r = inner.select().from(analyses).where(keyWhere(input)).get();
  if (!r) throw new Error('Analysis row missing after insert');
  return toAnalysis(r);
}

export async function getAnalysis(db: Db, id: string): Promise<AnalysisRecord | undefined> {
  const r = unwrap(db).select().from(analyses).where(eq(analyses.id, id)).get();
  return r && toAnalysis(r);
}

// --- guides and progress ------------------------------------------------------------------------

export interface GuideRecord {
  id: string;
  documentId: string;
  analysisId: string;
  sessionId: string;
  title: string;
  createdAt: number;
}

export type ChecklistState = 'unchecked' | 'have' | 'missing';

export interface ProgressRecord {
  guideId: string;
  currentStepId: string | null;
  completedStepIds: string[];
  checklist: Record<string, ChecklistState>;
  updatedAt: number;
}

const toProgress = (r: typeof progress.$inferSelect): ProgressRecord => ({
  guideId: r.guideId,
  currentStepId: r.currentStepId,
  completedStepIds: JSON.parse(r.completedStepsJson) as string[],
  checklist: JSON.parse(r.checklistJson) as Record<string, ChecklistState>,
  updatedAt: r.updatedAt,
});

/** Idempotent per document: a second call returns the guide created by the first. */
export async function createGuideForDocument(
  db: Db,
  input: { documentId: string; analysisId: string; sessionId: string; title: string },
  now: number,
): Promise<GuideRecord> {
  return unwrap(db).transaction((tx) => {
    const existing = tx.select().from(guides).where(eq(guides.documentId, input.documentId)).get();
    if (existing) return existing;
    const g = { id: randomUUID(), ...input, createdAt: now };
    tx.insert(guides).values(g).run();
    tx.insert(progress).values({ guideId: g.id, analysisId: input.analysisId, updatedAt: now }).run();
    return g;
  }, { behavior: 'immediate' });
}

export async function getGuideForDocument(db: Db, documentId: string): Promise<GuideRecord | undefined> {
  return unwrap(db).select().from(guides).where(eq(guides.documentId, documentId)).get();
}

export interface OwnedGuide {
  guide: GuideRecord;
  document: DocumentRecord;
  analysis: AnalysisRecord;
  progress: ProgressRecord;
}

export async function getOwnedGuide(db: Db, guideId: string, sessionId: string): Promise<OwnedGuide | undefined> {
  const inner = unwrap(db);
  const g = inner.select().from(guides).where(and(eq(guides.id, guideId), eq(guides.sessionId, sessionId))).get();
  if (!g) return undefined;
  const d = inner.select().from(documents).where(eq(documents.id, g.documentId)).get();
  const a = inner.select().from(analyses).where(eq(analyses.id, g.analysisId)).get();
  const p = inner.select().from(progress).where(eq(progress.guideId, g.id)).get();
  if (!d || !a || !p) return undefined;
  return { guide: g, document: toDoc(d), analysis: toAnalysis(a), progress: toProgress(p) };
}

export interface LibraryRow {
  document: DocumentRecord;
  guide: GuideRecord | undefined;
  analysis: AnalysisRecord | undefined;
  progress: ProgressRecord | undefined;
}

/** Every document of the session, newest first, with its guide and progress when published. */
export async function listLibrary(db: Db, sessionId: string): Promise<LibraryRow[]> {
  const inner = unwrap(db);
  const docs = inner.select().from(documents).where(eq(documents.sessionId, sessionId)).orderBy(desc(documents.createdAt), desc(documents.id)).all();
  if (docs.length === 0) return [];
  const ids = docs.map((d) => d.id);
  const gs = new Map(inner.select().from(guides).where(inArray(guides.documentId, ids)).all().map((g) => [g.documentId, g]));
  const out: LibraryRow[] = [];
  for (const d of docs) {
    const g = gs.get(d.id);
    const a = g && inner.select().from(analyses).where(eq(analyses.id, g.analysisId)).get();
    const p = g && inner.select().from(progress).where(eq(progress.guideId, g.id)).get();
    out.push({ document: toDoc(d), guide: g, analysis: a && toAnalysis(a), progress: p && toProgress(p) });
  }
  return out;
}

export async function saveProgress(
  db: Db,
  guideId: string,
  input: { currentStepId: string | null; completedStepIds: string[]; checklist: Record<string, ChecklistState> },
  now: number,
): Promise<ProgressRecord | undefined> {
  const r = unwrap(db)
    .update(progress)
    .set({
      currentStepId: input.currentStepId,
      completedStepsJson: JSON.stringify(input.completedStepIds),
      checklistJson: JSON.stringify(input.checklist),
      updatedAt: now,
    })
    .where(eq(progress.guideId, guideId))
    .returning()
    .get();
  return r && toProgress(r);
}

/**
 * Operations a client sends instead of its whole copy, so writes from several tabs commute.
 * `complete` / `uncomplete` are set operations (idempotent, must be disjoint); `currentStepId` and each
 * checklist key are last-writer-wins. Ids are validated against the guide by the caller.
 */
export interface ProgressOps {
  complete: string[];
  uncomplete: string[];
  currentStepId?: string | null;
  checklist: Record<string, ChecklistState>;
}

/** Applies `ops` to the current stored progress in one IMMEDIATE transaction and returns the merged result. */
export async function applyProgressOps(db: Db, guideId: string, ops: ProgressOps, now: number): Promise<ProgressRecord | undefined> {
  return unwrap(db).transaction((tx) => {
    const row = tx.select().from(progress).where(eq(progress.guideId, guideId)).get();
    if (!row) return undefined;
    const cur = toProgress(row);
    const drop = new Set(ops.uncomplete);
    const completed = cur.completedStepIds.filter((s) => !drop.has(s));
    for (const s of ops.complete) if (!completed.includes(s)) completed.push(s);
    // Null-prototype accumulator: keys come from the client (validated, but never trusted as plain-object keys).
    const checklist: Record<string, ChecklistState> = Object.assign(Object.create(null) as Record<string, ChecklistState>, cur.checklist);
    for (const [k, v] of Object.entries(ops.checklist)) checklist[k] = v;
    const r = tx
      .update(progress)
      .set({
        currentStepId: ops.currentStepId === undefined ? cur.currentStepId : ops.currentStepId,
        completedStepsJson: JSON.stringify(completed),
        checklistJson: JSON.stringify(checklist),
        updatedAt: now,
      })
      .where(eq(progress.guideId, guideId))
      .returning()
      .get();
    return r && toProgress(r);
  }, { behavior: 'immediate' });
}

// --- deletion -----------------------------------------------------------------------------------

/**
 * Deletes a document and everything hanging off it in one transaction, and returns the storage keys that are no
 * longer referenced by anything (originals always; page images only when no other document shares them).
 * Analyses are removed once no guide uses them. Returns undefined when the document is not the session's.
 */
export async function deleteDocumentCascade(db: Db, documentId: string, sessionId: string): Promise<{ orphanedKeys: string[] } | undefined> {
  return unwrap(db).transaction((tx) => {
    const doc = tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.sessionId, sessionId))).get();
    if (!doc) return undefined;
    const keys = new Set((JSON.parse(doc.originalFilesJson) as OriginalFile[]).map((f) => f.key));
    const gs = tx.select().from(guides).where(eq(guides.documentId, documentId)).all();
    const guideIds = gs.map((g) => g.id);
    if (guideIds.length > 0) {
      tx.delete(stepNotes).where(inArray(stepNotes.guideId, guideIds)).run();
      tx.delete(messages).where(inArray(messages.guideId, guideIds)).run();
      tx.delete(progress).where(inArray(progress.guideId, guideIds)).run();
      tx.delete(guides).where(inArray(guides.id, guideIds)).run();
    }
    const jobIds = tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.documentId, documentId)).all().map((j) => j.id);
    if (jobIds.length > 0) {
      tx.delete(jobArtifacts).where(inArray(jobArtifacts.jobId, jobIds)).run();
      tx.delete(jobs).where(inArray(jobs.id, jobIds)).run();
    }
    const mine = tx.select().from(pages).where(eq(pages.documentId, documentId)).all();
    tx.delete(pages).where(eq(pages.documentId, documentId)).run();
    for (const p of mine) {
      const stillUsed = tx.select({ id: pages.id }).from(pages).where(eq(pages.imagePath, p.imagePath)).limit(1).get();
      if (!stillUsed) keys.add(p.imagePath);
    }
    tx.delete(documents).where(eq(documents.id, documentId)).run();
    for (const analysisId of new Set(gs.map((g) => g.analysisId))) {
      const used = tx.select({ id: guides.id }).from(guides).where(eq(guides.analysisId, analysisId)).limit(1).get();
      if (!used) {
        tx.delete(simplifications).where(eq(simplifications.analysisId, analysisId)).run();
        tx.delete(analyses).where(eq(analyses.id, analysisId)).run();
      }
    }
    return { orphanedKeys: [...keys] };
  }, { behavior: 'immediate' });
}

// --- rate limiting --------------------------------------------------------------------------------

/**
 * Fixed-window counter. Atomically counts one hit for `key` and reports whether it is within `limit` per window.
 * `retryAfterMs` is the time until the window resets when the hit is refused.
 */
export async function hitRateLimit(db: Db, key: string, limit: number, windowMs: number, now: number): Promise<{ allowed: boolean; retryAfterMs: number }> {
  return unwrap(db).transaction((tx) => {
    const row = tx.select().from(rateLimits).where(eq(rateLimits.key, key)).get();
    if (!row || now - row.windowStart >= windowMs) {
      tx.insert(rateLimits).values({ key, windowStart: now, count: 1 }).onConflictDoUpdate({ target: rateLimits.key, set: { windowStart: now, count: 1 } }).run();
      return { allowed: limit >= 1, retryAfterMs: 0 };
    }
    if (row.count >= limit) return { allowed: false, retryAfterMs: row.windowStart + windowMs - now };
    tx.update(rateLimits).set({ count: row.count + 1 }).where(eq(rateLimits.key, key)).run();
    return { allowed: true, retryAfterMs: 0 };
  }, { behavior: 'immediate' });
}

// --- publish ----------------------------------------------------------------------------------------

/**
 * Publish stage in ONE transaction: store the analysis (or link an existing one), create the guide and progress rows,
 * mark the document ready. Idempotent per document. Returns undefined when the document no longer exists
 * (deleted while the job ran), writing nothing.
 */
export async function publishGuide(
  db: Db,
  input: {
    documentId: string;
    analysis: AnalysisKey & { sourceKind: DocumentKind; guideJson: string; schemaVersion: number; model?: string | null };
    title: string;
    pageCount: number;
  },
  now: number,
): Promise<GuideRecord | undefined> {
  return unwrap(db).transaction((tx) => {
    const doc = tx.select().from(documents).where(eq(documents.id, input.documentId)).get();
    if (!doc) return undefined;
    const a = input.analysis;
    tx.insert(analyses)
      .values({
        id: randomUUID(), contentHash: a.contentHash, pipelineVersion: a.pipelineVersion, provider: a.provider, sourceKind: a.sourceKind,
        ownerSessionId: a.ownerSessionId, guideJson: a.guideJson, schemaVersion: a.schemaVersion, model: a.model ?? null, createdAt: now,
      })
      .onConflictDoNothing()
      .run();
    const stored = tx.select().from(analyses).where(keyWhere(a)).get();
    if (!stored) throw new Error('Analysis row missing after insert');
    let guide = tx.select().from(guides).where(eq(guides.documentId, doc.id)).get();
    if (!guide) {
      guide = { id: randomUUID(), documentId: doc.id, analysisId: stored.id, sessionId: doc.sessionId, title: input.title, createdAt: now };
      tx.insert(guides).values(guide).run();
      tx.insert(progress).values({ guideId: guide.id, analysisId: stored.id, updatedAt: now }).run();
    }
    tx.update(documents).set({ status: 'ready', pageCount: input.pageCount, errorCode: null, errorMessage: null }).where(eq(documents.id, doc.id)).run();
    return guide;
  }, { behavior: 'immediate' });
}

export async function countSessionDocumentsSince(db: Db, sessionId: string, since: number): Promise<number> {
  const r = unwrap(db)
    .select({ n: sql<number>`count(*)` })
    .from(documents)
    .where(and(eq(documents.sessionId, sessionId), sql`${documents.createdAt} >= ${since}`))
    .get();
  return r?.n ?? 0;
}
