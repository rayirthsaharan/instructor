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
  /*
   * Fencing: heartbeat/complete/fail only succeed for the attempt that holds the lease.
   * `token` is the `attempts` value of the claimed Job. If omitted, the token this queue
   * instance recorded at its first claim of the job is used; unknown job => false/undefined.
   */
  /** Extend the lease; false means the lease was lost and the worker must stop. */
  heartbeat(id: string, leaseMs: number, patch?: { stage?: string; progress?: number }, token?: number): boolean;
  complete(id: string, token?: number): boolean;
  /** Requeues while attempts remain, otherwise marks the job failed. */
  fail(id: string, error: string, token?: number): Job | undefined;
  get(id: string): Job | undefined;
  saveArtifact(jobId: string, key: string, data: unknown): void;
  getArtifact(jobId: string, key: string): unknown | undefined;
}

export type JobHandler = (job: Job, ctx: { queue: JobQueue; heartbeat: (patch?: { stage?: string; progress?: number }) => boolean }) => Promise<void>;
