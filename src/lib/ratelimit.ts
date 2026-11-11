import { hitRateLimit, type Db } from './db';

export interface RateLimiter {
  /** Counts one hit for `key`. `allowed: false` means the caller is over `limit` for this window. */
  hit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

/** Fixed-window limiter stored in the database, so it is shared by every web process and survives restarts. */
export class DbRateLimiter implements RateLimiter {
  constructor(private readonly db: Db, private readonly clock: () => number = Date.now) {}
  hit(key: string, limit: number, windowMs: number) {
    return hitRateLimit(this.db, key, limit, windowMs, this.clock());
  }
}
