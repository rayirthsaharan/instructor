import type { AIProvider } from '../ai/provider';
import type { Db } from '../db';
import type { StorageAdapter } from '../storage';
import type { renderPdfPages, probePdf, RenderLimits } from '../render/pdf';

export type PipelineStage = 'ingest' | 'render' | 'analyse' | 'verify' | 'publish';

export interface PipelineDeps {
  db: Db;
  storage: StorageAdapter;
  provider: AIProvider;
  now: () => number;
  /** Injectable for tests; default is the child-process renderer. */
  renderPdfPages?: typeof renderPdfPages;
  probePdf?: typeof probePdf;
  renderLimits?: RenderLimits;
}

/** Progress reporting handed to every stage; returns false when the lease is lost and work must stop. */
export type Report = (stage: PipelineStage, percent: number) => Promise<void>;

export const JOB_TYPE = 'analyse_document';
