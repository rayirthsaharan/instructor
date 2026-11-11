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

export type WorkerLog = (message: string, error?: unknown) => void;

export interface WorkerOptions {
  leaseMs?: number;
  heartbeatMs?: number;
  /** Where database errors are reported. Defaults to console.error. */
  log?: WorkerLog;
  /** Injectable clock (ms) used to decide when failing heartbeats mean the lease has expired. */
  now?: () => number;
  /** Base delay between retries of a failed complete/fail call. Default 200. */
  retryMs?: number;
}

const defaultLog: WorkerLog = (message, error) => console.error(message, error);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Retry a finalising call a few times; on persistent failure log and give up (lease expiry will recover the job). */
async function settle<T>(what: string, fn: () => Promise<T>, log: WorkerLog, retryMs: number): Promise<T | undefined> {
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      log(`Worker: ${what} failed (attempt ${i + 1}/3)`, e);
      if (i < 2) await wait(retryMs * 2 ** i);
    }
  }
  return undefined;
}

/**
 * Claim and run at most one job. Returns true if a job was processed.
 * Errors from `claim` propagate (the caller backs off); errors while heartbeating or finishing are logged
 * and never crash the process.
 */
export async function runOnce(queue: JobQueue, registry: HandlerRegistry, opts: WorkerOptions = {}): Promise<boolean> {
  const leaseMs = opts.leaseMs ?? 60_000;
  const heartbeatMs = opts.heartbeatMs ?? leaseMs / 3;
  const log = opts.log ?? defaultLog;
  const now = opts.now ?? Date.now;
  const retryMs = opts.retryMs ?? 200;

  const job = await queue.claim(leaseMs);
  if (!job) return false;
  const token = job.attempts;
  const handler = registry.get(job.type);
  if (!handler) {
    await settle('fail', () => queue.fail(job.id, `No handler registered for job type "${job.type}"`, token), log, retryMs);
    return true;
  }

  const controller = new AbortController();
  let leaseLost = false;
  let lastOk = now();
  let beating = false;
  const heartbeat = async (patch?: { stage?: string; progress?: number }): Promise<boolean> => {
    try {
      const ok = await queue.heartbeat(job.id, leaseMs, token, patch);
      if (ok) {
        lastOk = now();
      } else {
        leaseLost = true;
        controller.abort();
      }
      return ok;
    } catch (e) {
      // Database trouble is not proof the lease is lost; retry on the next tick, but stop once it must have expired.
      log('Worker: heartbeat failed', e);
      if (now() - lastOk >= leaseMs) controller.abort();
      return !controller.signal.aborted;
    }
  };
  const timer = setInterval(() => {
    if (beating) return;
    beating = true;
    void heartbeat().finally(() => {
      beating = false;
    });
  }, heartbeatMs);
  try {
    const result = await handler(job, { queue, signal: controller.signal, heartbeat });
    if (!leaseLost) await settle('complete', () => queue.completeWithArtifacts(job.id, token, result?.artifacts ?? []), log, retryMs);
  } catch (e) {
    await settle('fail', () => queue.fail(job.id, e instanceof Error ? e.message : String(e), token), log, retryMs);
  } finally {
    clearInterval(timer);
  }
  return true;
}

export interface RunWorkerOptions extends WorkerOptions {
  /** Aborting stops the loop after the current job. */
  signal: AbortSignal;
  pollMs?: number;
  maxBackoffMs?: number;
  /** Injectable for tests. Must resolve early when the signal aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/** Poll loop. A database error is logged and retried with exponential backoff; it never ends the loop. */
export async function runWorker(queue: JobQueue, registry: HandlerRegistry, opts: RunWorkerOptions): Promise<void> {
  const pollMs = opts.pollMs ?? 1000;
  const maxBackoffMs = opts.maxBackoffMs ?? 30_000;
  const log = opts.log ?? defaultLog;
  const sleep = opts.sleep ?? abortableSleep;
  let failures = 0;
  while (!opts.signal.aborted) {
    try {
      const worked = await runOnce(queue, registry, opts);
      failures = 0;
      if (!worked) await sleep(pollMs, opts.signal);
    } catch (e) {
      failures += 1;
      const delay = Math.min(maxBackoffMs, pollMs * 2 ** (failures - 1));
      log(`Worker: poll failed (${failures} in a row); retrying in ${delay} ms`, e);
      await sleep(delay, opts.signal);
    }
  }
}
