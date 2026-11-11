import * as repo from '@/lib/db';
import type { Db } from '@/lib/db';
import type { Job, JobQueue } from './types';

function toJob(r: repo.JobRecord): Job {
  const { id, type, payload, documentId, status, stage, progress, attempts, maxAttempts, error } = r;
  return { id, type, payload, documentId, status, stage, progress, attempts, maxAttempts, error };
}

/** Database-backed queue. All SQL lives in src/lib/db. `clock` is injectable for tests. */
export class DbJobQueue implements JobQueue {
  constructor(private readonly db: Db, private readonly clock: () => number = Date.now) {}

  enqueue(input: { type: string; payload?: unknown; documentId?: string; maxAttempts?: number }): Job {
    return toJob(repo.insertJob(this.db, input, this.clock()));
  }
  claim(leaseMs: number): Job | undefined {
    const r = repo.claimJob(this.db, leaseMs, this.clock());
    return r && toJob(r);
  }
  heartbeat(id: string, leaseMs: number, patch?: { stage?: string; progress?: number }): boolean {
    return repo.heartbeatJob(this.db, id, leaseMs, this.clock(), patch);
  }
  complete(id: string): boolean {
    return repo.completeJob(this.db, id, this.clock());
  }
  fail(id: string, error: string): Job | undefined {
    const r = repo.failJob(this.db, id, error, this.clock());
    return r && toJob(r);
  }
  get(id: string): Job | undefined {
    const r = repo.getJob(this.db, id);
    return r && toJob(r);
  }
  saveArtifact(jobId: string, key: string, data: unknown): void {
    repo.saveJobArtifact(this.db, jobId, key, data, this.clock());
  }
  getArtifact(jobId: string, key: string): unknown | undefined {
    return repo.getJobArtifact(this.db, jobId, key);
  }
}
