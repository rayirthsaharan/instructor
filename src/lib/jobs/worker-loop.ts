import type { JobHandler, JobQueue } from './types';

export class HandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();
  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }
  get(type: string): JobHandler | undefined {
    return this.handlers.get(type);
  }
}

export interface WorkerOptions {
  leaseMs?: number;
  heartbeatMs?: number;
}

/** Claim and run at most one job. Returns true if a job was processed. */
export async function runOnce(queue: JobQueue, registry: HandlerRegistry, opts: WorkerOptions = {}): Promise<boolean> {
  const leaseMs = opts.leaseMs ?? 60_000;
  const heartbeatMs = opts.heartbeatMs ?? leaseMs / 3;
  const job = queue.claim(leaseMs);
  if (!job) return false;
  const handler = registry.get(job.type);
  if (!handler) {
    queue.fail(job.id, `No handler registered for job type "${job.type}"`, job.attempts);
    return true;
  }
  let leaseLost = false;
  const heartbeat = (patch?: { stage?: string; progress?: number }) => {
    const ok = queue.heartbeat(job.id, leaseMs, patch, job.attempts);
    if (!ok) leaseLost = true;
    return ok;
  };
  const timer = setInterval(() => heartbeat(), heartbeatMs);
  try {
    await handler(job, { queue, heartbeat });
    if (!leaseLost) queue.complete(job.id, job.attempts);
  } catch (e) {
    queue.fail(job.id, e instanceof Error ? e.message : String(e), job.attempts);
  } finally {
    clearInterval(timer);
  }
  return true;
}
