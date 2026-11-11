export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  type: string;
  payload: unknown;
  documentId: string | null;
  status: JobStatus;
  stage: string | null;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
}

export interface JobArtifact {
  key: string;
  data: unknown;
}

/** What a handler may return: artifacts to persist atomically with completion. */
export interface JobResult {
  artifacts?: JobArtifact[];
}

/*
 * Every method returns a Promise so the implementation can move to a networked database (D-010).
 *
 * Fencing: heartbeat/complete/fail succeed only for the attempt that holds the lease. `token` is
 * REQUIRED and is the `attempts` value of the Job returned by `claim`. There is no remembered
 * token: a caller that lost the lease cannot act on the job.
 */
export interface JobQueue {
  enqueue(input: { type: string; payload?: unknown; documentId?: string; maxAttempts?: number }): Promise<Job>;
  /** Atomically lease the next runnable job (queued, or running with an expired lease). */
  claim(leaseMs: number): Promise<Job | undefined>;
  /** Extend the lease; false means the lease was lost and the worker must stop. */
  heartbeat(id: string, leaseMs: number, token: number, patch?: { stage?: string; progress?: number }): Promise<boolean>;
  complete(id: string, token: number): Promise<boolean>;
  /**
   * Save artifacts and mark the job done in one transaction that re-checks status and token.
   * Returns false (and writes nothing) if the lease was lost.
   */
  completeWithArtifacts(id: string, token: number, artifacts: JobArtifact[]): Promise<boolean>;
  /** Requeues while attempts remain, otherwise marks the job failed. */
  fail(id: string, error: string, token: number): Promise<Job | undefined>;
  get(id: string): Promise<Job | undefined>;
  /** Fenced like complete(): returns false and writes nothing unless `token` still holds the running job. */
  saveArtifact(jobId: string, key: string, data: unknown, token: number): Promise<boolean>;
  getArtifact(jobId: string, key: string): Promise<unknown | undefined>;
}

export interface JobContext {
  queue: JobQueue;
  /** Aborted when a heartbeat reports the lease lost or heartbeats keep failing past the lease. Handlers must stop. */
  signal: AbortSignal;
  /** Extend the lease and record progress. Resolves false if the lease is lost. */
  heartbeat: (patch?: { stage?: string; progress?: number }) => Promise<boolean>;
}

export type JobHandler = (job: Job, ctx: JobContext) => Promise<JobResult | void>;
