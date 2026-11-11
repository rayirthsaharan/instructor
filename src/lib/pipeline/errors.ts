import { AIProviderError } from '../ai/provider';
import { ImageError } from '../render/image';
import { RenderError } from '../render/pdf';

/** A failure the user should see as-is. `retryable` failures are retried by the queue before the document is marked failed. */
export class PipelineError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) {
    super(message);
    this.name = 'PipelineError';
  }
}

export interface Classified {
  code: string;
  /** Shown to the user. Never contains internals. */
  message: string;
  retryable: boolean;
}

export function classifyError(e: unknown): Classified {
  if (e instanceof PipelineError) return { code: e.code, message: e.message, retryable: e.retryable };
  if (e instanceof AIProviderError) {
    return { code: 'analysis_unavailable', message: 'The analysis service could not finish this manual. Please try again.', retryable: e.retryable };
  }
  if (e instanceof RenderError) {
    if (e.code === 'encrypted_pdf') return { code: 'encrypted_pdf', message: 'This PDF is password protected.', retryable: false };
    if (e.code === 'corrupt_file') return { code: 'corrupt_file', message: 'This file could not be read. It may be damaged.', retryable: false };
    return { code: 'render_failed', message: 'The pages of this file could not be prepared. Please try again.', retryable: true };
  }
  if (e instanceof ImageError) return { code: 'corrupt_file', message: 'One of the photos could not be read. It may be damaged.', retryable: false };
  return { code: 'pipeline_failed', message: 'Something went wrong while preparing this manual. Please try again.', retryable: true };
}
