// Client-side mirror of the HTTP contract (M1). Do not import server code here.

export type DocumentStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'rejected';
export type DocumentStage = 'ingest' | 'render' | 'analyse' | 'verify' | 'publish';

export interface DocumentState {
  id: string;
  status: DocumentStatus;
  stage: DocumentStage | null;
  /** 0..1 */
  progress: number;
  pageCount: number | null;
  pagesRendered: number | null;
  guideId: string | null;
  error: { code: string; message: string } | null;
  title: string | null;
  /** Pipeline runs so far, including the server's own automatic retries. Not used for copy. */
  attempts?: number;
  /** Times the user pressed "Try again" (POST /retry). Drives the repeated-failure copy. */
  retryCount?: number;
  /** True when the guide came from an analysis the app already had (no provider calls). */
  reused?: boolean;
}

export interface GuideSummary {
  /** null until a guide exists (queued, processing, failed, rejected): link by documentId. */
  id: string | null;
  documentId: string;
  title: string | null;
  stepCount: number;
  estimatedMinutes: number | null;
  progress: { currentStepId: string | null; currentStepTitle?: string | null; completedCount: number; percent: number };
  status: DocumentStatus;
  /** Epoch milliseconds (ISO strings are tolerated). */
  updatedAt: number | string;
  /** 0-based page index used as the thumbnail. */
  thumbnailPage: number | null;
}

export type UploadErrorCode =
  | 'unsupported_type'
  | 'too_large'
  | 'too_many_pages'
  | 'encrypted_pdf'
  | 'corrupt_file'
  | 'empty'
  | 'rate_limited'
  | 'quota_exceeded';

export type ClientErrorCode = UploadErrorCode | 'not_found' | 'network' | 'aborted' | 'unknown';
