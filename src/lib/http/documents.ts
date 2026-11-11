import { randomUUID } from 'node:crypto';
import {
  countPages, deleteDocumentCascade, getGuideForDocument, getLatestJobForDocument, getOwnedDocument, getPage, insertDocument,
  requeueFailedDocument, updateDocument, type DocumentRecord, type DocumentStatus, type OriginalFile,
} from '../db';
import { UPLOAD_LIMIT_PER_IP, UPLOAD_LIMIT_PER_SESSION } from '../limits';
import { JOB_TYPE } from '../pipeline/types';
import { readUploadFiles, validateUpload } from '../upload/validate';
import { clientIp, type AppContext, type SessionInfo } from './context';
import { ApiError, json, notFound, parseId } from './respond';
import type { StorageAdapter } from '../storage';

export interface DocumentView {
  id: string;
  status: DocumentStatus;
  stage: 'ingest' | 'render' | 'analyse' | 'verify' | 'publish' | null;
  progress: number;
  pageCount: number | null;
  pagesRendered: number;
  guideId: string | null;
  error: { code: string; message: string } | null;
  title: string | null;
}

const STAGES = new Set(['ingest', 'render', 'analyse', 'verify', 'publish']);

/** What the status endpoint reports. Terminal states come from the document; in-flight state from its latest job. */
export async function documentView(ctx: AppContext, doc: DocumentRecord): Promise<DocumentView> {
  const job = await getLatestJobForDocument(ctx.db, doc.id);
  let status = doc.status;
  let error = doc.errorCode ? { code: doc.errorCode, message: doc.errorMessage ?? 'Something went wrong.' } : null;
  // The job ran out of attempts (for example the worker kept dying): tell the user instead of showing "processing" forever.
  if ((status === 'queued' || status === 'processing') && job?.status === 'failed') {
    status = 'failed';
    error = { code: 'pipeline_failed', message: 'The analysis did not finish. Please try again.' };
  }
  const guide = await getGuideForDocument(ctx.db, doc.id);
  const stage = job?.stage && STAGES.has(job.stage) && status !== 'ready' && status !== 'queued' ? (job.stage as DocumentView['stage']) : null;
  const progress = status === 'ready' ? 1 : status === 'queued' ? 0 : Math.min(1, Math.max(0, (job?.progress ?? 0) / 100));
  return {
    id: doc.id,
    status,
    stage,
    progress,
    pageCount: doc.pageCount,
    pagesRendered: await countPages(ctx.db, doc.id),
    guideId: guide?.id ?? null,
    error,
    title: guide?.title ?? null,
  };
}

async function ownedDocument(ctx: AppContext, session: SessionInfo, rawId: string): Promise<DocumentRecord> {
  const doc = await getOwnedDocument(ctx.db, parseId(rawId), session.sessionId);
  if (!doc) throw notFound('That document');
  return doc;
}

async function enforceUploadLimits(ctx: AppContext, session: SessionInfo, req: Request): Promise<void> {
  const checks = [
    await ctx.limiter.hit(`upload:session:${session.sessionId}`, UPLOAD_LIMIT_PER_SESSION.limit, UPLOAD_LIMIT_PER_SESSION.windowMs),
    await ctx.limiter.hit(`upload:ip:${clientIp(req)}`, UPLOAD_LIMIT_PER_IP.limit, UPLOAD_LIMIT_PER_IP.windowMs),
  ];
  const blocked = checks.find((c) => !c.allowed);
  if (blocked) {
    const secs = Math.max(1, Math.ceil(blocked.retryAfterMs / 1000));
    throw new ApiError('rate_limited', 'You have uploaded a lot in a short time. Please wait a little and try again.', 429, secs);
  }
}

async function removeKeys(storage: StorageAdapter, keys: string[]): Promise<void> {
  for (const k of keys) {
    try {
      await storage.delete(k);
    } catch (e) {
      console.error('Could not delete stored file', k, e);
    }
  }
}

export async function createDocument(req: Request, ctx: AppContext, session: SessionInfo): Promise<Response> {
  await enforceUploadLimits(ctx, session, req);
  const upload = await validateUpload(await readUploadFiles(req));

  const id = randomUUID();
  const originals: OriginalFile[] = upload.files.map((f, i) => ({
    key: `originals/${id}/${upload.kind === 'pdf' ? 'original' : String(i + 1).padStart(3, '0')}.${f.ext}`,
    mime: f.mime,
    size: f.bytes.byteLength,
  }));
  try {
    for (const [i, f] of upload.files.entries()) await ctx.storage.put(originals[i]!.key, f.bytes);
    await insertDocument(
      ctx.db,
      { id, sessionId: session.sessionId, contentHash: upload.contentHash, kind: upload.kind, originalFiles: originals, pageCount: upload.pageCount },
      ctx.now(),
    );
    await ctx.queue.enqueue({ type: JOB_TYPE, payload: { documentId: id }, documentId: id });
  } catch (e) {
    await deleteDocumentCascade(ctx.db, id, session.sessionId);
    await removeKeys(ctx.storage, originals.map((o) => o.key));
    throw e;
  }
  return json({ documentId: id }, 201);
}

export async function getDocumentStatus(ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  return json(await documentView(ctx, await ownedDocument(ctx, session, rawId)));
}

export async function retryDocument(req: Request, ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  const doc = await ownedDocument(ctx, session, rawId);
  const view = await documentView(ctx, doc);
  if (view.status !== 'failed') throw new ApiError('conflict', 'Only a document that failed can be retried.', 409);
  await enforceUploadLimits(ctx, session, req);
  await updateDocument(ctx.db, doc.id, { status: 'failed' }); // settle a job-level failure before requeueing
  if (await requeueFailedDocument(ctx.db, doc.id)) {
    await ctx.queue.enqueue({ type: JOB_TYPE, payload: { documentId: doc.id }, documentId: doc.id });
  }
  return json(await documentView(ctx, (await ownedDocument(ctx, session, rawId))), 202);
}

/** Deletes a document, its guide and files. Shared analyses and page images survive while anything else uses them. */
export async function deleteOwnedDocument(ctx: AppContext, session: SessionInfo, documentId: string): Promise<boolean> {
  const res = await deleteDocumentCascade(ctx.db, documentId, session.sessionId);
  if (!res) return false;
  await removeKeys(ctx.storage, res.orphanedKeys);
  return true;
}

export async function deleteDocumentRoute(ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  if (!(await deleteOwnedDocument(ctx, session, parseId(rawId)))) throw notFound('That document');
  return json({ deleted: true });
}

const FILE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', webp: 'image/webp' };

export async function getPageImage(ctx: AppContext, session: SessionInfo, rawId: string, rawIndex: string): Promise<Response> {
  const doc = await ownedDocument(ctx, session, rawId);
  if (!/^\d{1,5}$/.test(rawIndex)) throw notFound('That page');
  const page = await getPage(ctx.db, doc.id, Number(rawIndex));
  const type = page && IMAGE_TYPES[page.imagePath.split('.').pop() ?? ''];
  if (!page || !type) throw notFound('That page');
  let data: Buffer;
  try {
    data = await ctx.storage.get(page.imagePath);
  } catch {
    throw notFound('That page');
  }
  return new Response(new Uint8Array(data), {
    headers: { ...FILE_HEADERS, 'Content-Type': type, 'Content-Length': String(data.length), 'Cache-Control': 'private, max-age=3600' },
  });
}

const ORIGINAL_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

/** The upload exactly as received, always as an attachment. For photo sets, `?index=` picks the photo (default first). */
export async function getOriginal(ctx: AppContext, session: SessionInfo, rawId: string, req: Request): Promise<Response> {
  const doc = await ownedDocument(ctx, session, rawId);
  const rawIndex = new URL(req.url).searchParams.get('index') ?? '0';
  if (!/^\d{1,3}$/.test(rawIndex)) throw notFound('That file');
  const file = doc.originalFiles[Number(rawIndex)];
  if (!file || !ORIGINAL_TYPES.has(file.mime)) throw notFound('That file');
  let data: Buffer;
  try {
    data = await ctx.storage.get(file.key);
  } catch {
    throw notFound('That file');
  }
  const ext = file.key.split('.').pop() ?? 'bin';
  const name = doc.kind === 'pdf' ? `manual.${ext}` : `photo-${Number(rawIndex) + 1}.${ext}`;
  return new Response(new Uint8Array(data), {
    headers: {
      ...FILE_HEADERS,
      'Content-Type': file.mime,
      'Content-Length': String(data.length),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
