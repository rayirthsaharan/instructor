import { getConfig } from '../config';
import { ensureSession, getDb, type Db } from '../db';
import { createStorage } from '../storage';
import type { StorageAdapter } from '../storage';
import { DbJobQueue, type JobQueue } from '../jobs';
import { newSessionId, sessionCookieName, readCookie, sessionSecret, sessionSetCookie, verifySessionValue } from '../session/cookie';
import type { AIProvider } from '../ai';
import { DbRateLimiter, type RateLimiter } from '../ratelimit';

/** Everything a route handler needs. Tests build their own with an isolated database and storage. */
export interface AppContext {
  db: Db;
  storage: StorageAdapter;
  queue: JobQueue;
  limiter: RateLimiter;
  secret: string;
  secureCookies: boolean;
  /** Trusted reverse proxies in front of the app (config TRUST_PROXY_HOPS). 0 = no client IP is available. */
  trustProxyHops: number;
  /** Guides a session may create per 30 days; undefined = unlimited. */
  freeGuidesPerMonth?: number;
  now: () => number;
  /** AI provider for the assistant; undefined = chosen from AI_PROVIDER at request time. Tests set it. */
  provider?: AIProvider;
  assistantLimits?: AssistantLimits;
}

export interface AssistantLimits {
  /** Questions per session per window. */
  messages: { limit: number; windowMs: number };
  /** Answers streaming at once in this process. */
  maxStreams: number;
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
      trustProxyHops: config.trustProxyHops,
      freeGuidesPerMonth: config.freeGuidesPerMonth,
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
  /** Persists the session row. Called by the first write only, so cookieless reads leave nothing in the database. */
  ensure: () => Promise<void>;
}

/** Reads the signed cookie, or mints a new id (and cookie). Nothing is written to the database here. */
export async function resolveSession(ctx: AppContext, req: Request): Promise<SessionInfo> {
  const existing = verifySessionValue(readCookie(req.headers.get('cookie'), sessionCookieName(ctx.secureCookies)), ctx.secret);
  const id = existing ?? newSessionId();
  const ensure = () => ensureSession(ctx.db, id, ctx.now());
  return { sessionId: id, ensure, ...(existing ? {} : { setCookie: sessionSetCookie(id, ctx.secret, ctx.secureCookies) }) };
}

/**
 * The client IP, or undefined when none can be trusted. With `trustedHops` = 0 (default) forwarding headers are ignored
 * entirely, because any client can send them. With N, the Nth entry from the right of X-Forwarded-For is used (the
 * address the outermost trusted proxy saw).
 */
export function clientIp(req: Request, trustedHops: number): string | undefined {
  if (trustedHops <= 0) return undefined;
  const parts = (req.headers.get('x-forwarded-for') ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  const ip = parts[parts.length - trustedHops];
  return ip && ip.length <= 64 ? ip : undefined;
}
