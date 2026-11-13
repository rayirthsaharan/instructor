import { z } from 'zod';
import { getDocument, updateDocument, type DocumentRecord } from '../db';
import type { AnalyseDocumentResult } from '../ai/provider';
import { validateGuide, type ValidatedGuide } from '../guide/validate';
import type { JobContext, JobHandler, Job } from '../jobs';
import { classifyError, PipelineError } from './errors';
import { ingestStage, loadPageImages, panelsInput, panelStage, publishStage, renderStage, validateOrThrow } from './stages';
import { JOB_TYPE, type PipelineDeps, type PipelineStage } from './types';

export { JOB_TYPE };

const payloadSchema = z.object({ documentId: z.string().min(1) });

async function artifact<T>(ctx: JobContext, job: Job, key: string, make: () => Promise<T>): Promise<T> {
  const saved = await ctx.queue.getArtifact(job.id, key);
  if (saved !== undefined) return saved as T;
  const value = await make();
  // Fenced: if the lease was lost nothing is written and the next attempt starts from the previous artifact.
  await ctx.queue.saveArtifact(job.id, key, value, job.attempts);
  return value;
}

/** Runs the whole pipeline for one document. Throws only for retryable failures; terminal outcomes are written to the document. */
export async function runAnalysis(deps: PipelineDeps, job: Job, ctx: JobContext): Promise<void> {
  const parsed = payloadSchema.safeParse(job.payload);
  if (!parsed.success) return; // a malformed job can never succeed; finish it
  const doc = await getDocument(deps.db, parsed.data.documentId);
  if (!doc) return; // deleted while queued
  if (doc.status === 'ready' || doc.status === 'rejected') return;

  const report = async (stage: PipelineStage, percent: number) => {
    if (!(await ctx.heartbeat({ stage, progress: percent }))) throw new PipelineError('aborted', 'Lease lost', true);
  };

  try {
    await updateDocument(deps.db, doc.id, { status: 'processing', errorCode: null, errorMessage: null });
    await analyse(deps, doc, job, ctx, report);
  } catch (e) {
    if (ctx.signal.aborted) throw e; // lease lost: the next claimant takes over, never write state
    const c = classifyError(e);
    if (c.retryable && job.attempts < job.maxAttempts) throw e; // queue retries
    console.error(`Pipeline: document ${doc.id} failed (${c.code})`, e);
    await updateDocument(deps.db, doc.id, { status: 'failed', errorCode: c.code, errorMessage: c.message });
  }
}

async function analyse(deps: PipelineDeps, doc: DocumentRecord, job: Job, ctx: JobContext, report: (s: PipelineStage, p: number) => Promise<void>): Promise<void> {
  const { existing } = await ingestStage(deps, doc, report);
  await updateDocument(deps.db, doc.id, { reused: existing !== undefined });
  let pages = await renderStage(deps, doc, report, ctx.signal);

  let guide: ValidatedGuide;
  if (existing) {
    // Same content already analysed for this owner: link it, no provider calls.
    const r = validateGuide(JSON.parse(existing.guideJson), { pageCount: pages.length });
    if (!r.ok) throw new PipelineError('invalid_analysis', 'The stored analysis for this document is no longer valid.');
    guide = r.guide;
  } else {
    pages = await panelStage(deps, doc, pages, report, ctx.signal);
    const images = await loadPageImages(deps, pages);
    await report('analyse', 40);
    const result = await artifact<AnalyseDocumentResult>(ctx, job, 'analyse', () =>
      deps.provider.analyseDocument({
        pages: images,
        panels: panelsInput(pages),
        contentHash: doc.contentHash,
        signal: ctx.signal,
        onProgress: (p) => void ctx.heartbeat({ stage: 'analyse', progress: 40 + Math.round(p.fraction * 30) }),
      }),
    );
    if (result.kind === 'not_a_manual') {
      await updateDocument(deps.db, doc.id, { status: 'rejected', errorCode: 'not_a_manual', errorMessage: result.reason });
      return;
    }
    const draftGuide = validateOrThrow(result.draft, pages, 'analysis');
    await report('verify', 75);
    const verified = await artifact<{ draft: unknown }>(ctx, job, 'verify', async () => {
      const v = await deps.provider.verifyGuide({ guide: draftGuide, pages: images, signal: ctx.signal });
      return { draft: v.draft };
    });
    guide = validateOrThrow(verified.draft, pages, 'verification');
  }

  const guideId = await publishStage(deps, doc, guide, pages.length, report);
  if (!guideId) return; // document deleted meanwhile; nothing was written
}

export function createAnalysisHandler(deps: PipelineDeps): JobHandler {
  return async (job, ctx) => {
    await runAnalysis(deps, job, ctx);
  };
}
