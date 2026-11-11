import { and, eq, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { unwrap, type Db } from './client';
import { jobs, jobArtifacts } from './schema';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobRecord {
  id: string;
  documentId: string | null;
  type: string;
  payload: unknown;
  status: JobStatus;
  stage: string | null;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  leaseUntil: number | null;
  heartbeatAt: number | null;
  createdAt: number;
  updatedAt: number;
}

type Row = typeof jobs.$inferSelect;

function toRecord(r: Row): JobRecord {
  return { ...r, payload: JSON.parse(r.payloadJson) as unknown };
}

export function insertJob(
  db: Db,
  input: { type: string; payload?: unknown; documentId?: string; maxAttempts?: number },
  now: number,
): JobRecord {
  const row: Row = {
    id: randomUUID(),
    documentId: input.documentId ?? null,
    type: input.type,
    payloadJson: JSON.stringify(input.payload ?? {}),
    status: 'queued',
    stage: null,
    progress: 0,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 3,
    error: null,
    leaseUntil: null,
    heartbeatAt: null,
    createdAt: now,
    updatedAt: now,
  };
  unwrap(db).insert(jobs).values(row).run();
  return toRecord(row);
}

export function getJob(db: Db, id: string): JobRecord | undefined {
  const r = unwrap(db).select().from(jobs).where(eq(jobs.id, id)).get();
  return r ? toRecord(r) : undefined;
}

/**
 * Atomically claim the oldest runnable job: queued, or running with an expired lease.
 * Jobs whose lease expired with no attempts left are marked failed instead of claimed.
 * Runs in an IMMEDIATE transaction so competing claimers serialise.
 */
export function claimJob(db: Db, leaseMs: number, now: number): JobRecord | undefined {
  return unwrap(db).transaction((tx) => {
    tx.update(jobs)
      .set({ status: 'failed', error: 'Lease expired and attempts exhausted', leaseUntil: null, updatedAt: now })
      .where(and(eq(jobs.status, 'running'), lte(jobs.leaseUntil, now), sql`${jobs.attempts} >= ${jobs.maxAttempts}`))
      .run();
    const candidate = tx
      .select()
      .from(jobs)
      .where(or(eq(jobs.status, 'queued'), and(eq(jobs.status, 'running'), lte(jobs.leaseUntil, now))))
      .orderBy(jobs.createdAt, jobs.id)
      .limit(1)
      .get();
    if (!candidate) return undefined;
    const updated = tx
      .update(jobs)
      .set({
        status: 'running',
        attempts: candidate.attempts + 1,
        leaseUntil: now + leaseMs,
        heartbeatAt: now,
        updatedAt: now,
      })
      .where(eq(jobs.id, candidate.id))
      .returning()
      .get();
    return updated ? toRecord(updated) : undefined;
  }, { behavior: 'immediate' });
}

/** Extend the lease. Returns false if the job is no longer running (lease lost). */
export function heartbeatJob(db: Db, id: string, attempt: number, leaseMs: number, now: number, patch?: { stage?: string; progress?: number }): boolean {
  const res = unwrap(db)
    .update(jobs)
    .set({ leaseUntil: now + leaseMs, heartbeatAt: now, updatedAt: now, ...patch })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.attempts, attempt)))
    .run();
  return res.changes > 0;
}

/** `attempt` is the fencing token: the attempts value returned by claimJob. */
export function completeJob(db: Db, id: string, attempt: number, now: number): boolean {
  const res = unwrap(db)
    .update(jobs)
    .set({ status: 'done', progress: 100, leaseUntil: null, error: null, updatedAt: now })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.attempts, attempt)))
    .run();
  return res.changes > 0;
}

/** Record a failure: requeue if attempts remain, otherwise mark failed. */
export function failJob(db: Db, id: string, attempt: number, error: string, now: number): JobRecord | undefined {
  return unwrap(db).transaction((tx) => {
    const j = tx.select().from(jobs).where(eq(jobs.id, id)).get();
    if (!j || j.status !== 'running' || j.attempts !== attempt) return undefined;
    const status = j.attempts >= j.maxAttempts ? 'failed' : 'queued';
    const r = tx
      .update(jobs)
      .set({ status, error, leaseUntil: null, updatedAt: now })
      .where(eq(jobs.id, id))
      .returning()
      .get();
    return r ? toRecord(r) : undefined;
  }, { behavior: 'immediate' });
}

export function saveJobArtifact(db: Db, jobId: string, key: string, data: unknown, now: number): void {
  const dataJson = JSON.stringify(data);
  unwrap(db)
    .insert(jobArtifacts)
    .values({ jobId, key, dataJson, createdAt: now })
    .onConflictDoNothing()
    .run();
}

export function getJobArtifact(db: Db, jobId: string, key: string): unknown | undefined {
  const r = unwrap(db)
    .select()
    .from(jobArtifacts)
    .where(and(eq(jobArtifacts.jobId, jobId), eq(jobArtifacts.key, key)))
    .get();
  return r ? (JSON.parse(r.dataJson) as unknown) : undefined;
}
