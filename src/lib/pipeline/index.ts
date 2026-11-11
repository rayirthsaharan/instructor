import { getConfig } from '../config';
import { getAIProvider } from '../ai';
import type { Db } from '../db';
import type { StorageAdapter } from '../storage';
import { createAnalysisHandler } from './handler';
import { JOB_TYPE, type PipelineDeps } from './types';
import type { HandlerRegistry } from '../jobs';

export { JOB_TYPE, createAnalysisHandler };
export type { PipelineDeps };
export { runAnalysis } from './handler';

/** Dependencies from configuration (the provider comes from AI_PROVIDER; the default is the mock). */
export function createPipelineDeps(db: Db, storage: StorageAdapter): PipelineDeps {
  const config = getConfig();
  return {
    db,
    storage,
    provider: getAIProvider({ AI_PROVIDER: config.aiProvider }, { delayMs: config.mockAiDelayMs }),
    now: Date.now,
  };
}

export function registerPipeline(registry: HandlerRegistry, deps: PipelineDeps): void {
  registry.register(JOB_TYPE, createAnalysisHandler(deps));
}
