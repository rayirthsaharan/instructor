import * as repo from '@/lib/db';
import type { Db } from '@/lib/db';
import type { Job, JobArtifact, JobQueue } from './types';

function toJob(r: repo.JobRecord): Job {
  const { id, type, payload, documentId, status, stage, progress, attempts, maxAttempts, error } = r;
  return { id, type, payload, documentId, status, stage, progress, attempts, maxAttempts, error };
}

/** Database-backed queue. All SQL lives in src/lib/db. `clock` is injectable for tests. */
export class DbJobQueue implements JobQueue {
  constructor(private readonly db: Db, private readonly clock: () => number = Date.now) {}

  async enqueue(input: { type: string; payload?: unknown; documentId?: string; maxAttempts?: number }): Promise<Job> {
    return toJob(await repo.insertJob(this.db, input, this.clock()));
  }
  async claim(leaseMs: number): Promise<Job | undefined> {
    const r = await repo.claimJob(this.db, leaseMs, this.clock());
    return r && toJob(r);
  }
  heartbeat(id: string, leaseMs: number, token: number, patch?: { stage?: string; progress?: number }): Promise<boolean> {
    return repo.heartbeatJob(this.db, id, token, leaseMs, this.clock(), patch);
  }
  complete(id: string, token: number): Promise<boolean> {
    return repo.completeJob(this.db, id, token, this.clock());
  }
  completeWithArtifacts(id: string, token: number, artifacts: JobArtifact[]): Promise<boolean> {
    return repo.completeJobWithArtifacts(this.db, id, token, artifacts, this.clock());
  }
  async fail(id: string, error: string, token: number): Promise<Job | undefined> {
    const r = await repo.failJob(this.db, id, token, error, this.clock());
    return r && toJob(r);
  }
  async get(id: string): Promise<Job | undefined> {
    const r = await repo.getJob(this.db, id);
    return r && toJob(r);
  }
  saveArtifact(jobId: string, key: string, data: unknown): Promise<void> {
    return repo.saveJobArtifact(this.db, jobId, key, data, this.clock());
  }
  getArtifact(jobId: string, key: string): Promise<unknown | undefined> {
    return repo.getJobArtifact(this.db, jobId, key);
  }
}
