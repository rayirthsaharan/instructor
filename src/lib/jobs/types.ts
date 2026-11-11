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

export interface JobQueue {
  enqueue(input: { type: string; payload?: unknown; documentId?: string; maxAttempts?: number }): Job;
  /** Atomically lease the next runnable job (queued, or running with an expired lease). */
  claim(leaseMs: number): Job | undefined;
  /** Extend the lease; false means the lease was lost and the worker must stop. */
  heartbeat(id: string, leaseMs: number, patch?: { stage?: string; progress?: number }): boolean;
  complete(id: string): boolean;
  /** Requeues while attempts remain, otherwise marks the job failed. */
  fail(id: string, error: string): Job | undefined;
  get(id: string): Job | undefined;
  saveArtifact(jobId: string, key: string, data: unknown): void;
  getArtifact(jobId: string, key: string): unknown | undefined;
}

export type JobHandler = (job: Job, ctx: { queue: JobQueue; heartbeat: (patch?: { stage?: string; progress?: number }) => boolean }) => Promise<void>;
