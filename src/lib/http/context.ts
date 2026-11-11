import { getConfig } from '../config';
import { ensureSession, getDb, sessionExists, type Db } from '../db';
import { createStorage } from '../storage';
import type { StorageAdapter } from '../storage';
import { DbJobQueue, type JobQueue } from '../jobs';
import { SESSION_COOKIE, newSessionId, readCookie, sessionSecret, sessionSetCookie, verifySessionValue } from '../session/cookie';
import { DbRateLimiter, type RateLimiter } from '../ratelimit';

/** Everything a route handler needs. Tests build their own with an isolated database and storage. */
export interface AppContext {
  db: Db;
  storage: StorageAdapter;
  queue: JobQueue;
  limiter: RateLimiter;
  secret: string;
  secureCookies: boolean;
  now: () => number;
}

let shared: AppContext | undefined;
let override: AppContext | undefined;

/** Process-wide context from configuration. Created lazily at request time, never at module load. */
export function getAppContext(): AppContext {
  if (override) return override;
  if (!shared) {
    const config = getConfig();
    const db = getDb();
    shared = {
      db,
      storage: createStorage(config.storageRoot),
      queue: new DbJobQueue(db),
      limiter: new DbRateLimiter(db),
      secret: sessionSecret(config.sessionSecret),
      secureCookies: config.isProduction,
      now: Date.now,
    };
  }
  return shared;
}

/** Test hook: route handlers use this context instead of the configured one. */
export function setAppContextForTests(ctx: AppContext | undefined): void {
  override = ctx;
}

export interface SessionInfo {
  sessionId: string;
  /** Present only when a new cookie must be sent. */
  setCookie?: string;
}

/** Reads the signed cookie; creates (and persists) a new session when absent or invalid. */
export async function resolveSession(ctx: AppContext, req: Request): Promise<SessionInfo> {
  const existing = verifySessionValue(readCookie(req.headers.get('cookie'), SESSION_COOKIE), ctx.secret);
  if (existing) {
    // A valid signature with no row (e.g. a reset database) is re-created rather than trusted blindly.
    if (!(await sessionExists(ctx.db, existing))) await ensureSession(ctx.db, existing, ctx.now());
    return { sessionId: existing };
  }
  const id = newSessionId();
  await ensureSession(ctx.db, id, ctx.now());
  return { sessionId: id, setCookie: sessionSetCookie(id, ctx.secret, ctx.secureCookies) };
}

/** First hop of the client IP. Behind a proxy this must be set by a trusted proxy; locally it falls back to "unknown". */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  const first = fwd?.split(',')[0]?.trim();
  return first && first.length <= 64 ? first : (req.headers.get('x-real-ip')?.trim().slice(0, 64) || 'unknown');
}
