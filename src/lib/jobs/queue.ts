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
  private readonly tokens = new Map<string, number>();

  claim(leaseMs: number): Job | undefined {
    const r = repo.claimJob(this.db, leaseMs, this.clock());
    if (r && !this.tokens.has(r.id)) this.tokens.set(r.id, r.attempts);
    return r && toJob(r);
  }
  heartbeat(id: string, leaseMs: number, patch?: { stage?: string; progress?: number }, token?: number): boolean {
    const t = token ?? this.tokens.get(id);
    return t !== undefined && repo.heartbeatJob(this.db, id, t, leaseMs, this.clock(), patch);
  }
  complete(id: string, token?: number): boolean {
    const t = token ?? this.tokens.get(id);
    this.tokens.delete(id);
    return t !== undefined && repo.completeJob(this.db, id, t, this.clock());
  }
  fail(id: string, error: string, token?: number): Job | undefined {
    const t = token ?? this.tokens.get(id);
    this.tokens.delete(id);
    const r = t === undefined ? undefined : repo.failJob(this.db, id, t, error, this.clock());
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
