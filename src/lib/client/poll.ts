export const POLL_MIN_MS = 1000;
export const POLL_MAX_MS = 5000;
export const POLL_ERROR_MAX_MS = 10000;
export const SLOW_AFTER_MS = 60_000;

/**
 * Next polling delay. A change resets to the minimum; an unchanged answer backs off x1.5 up to 5 s;
 * a failed request backs off x2 up to 10 s.
 */
export function nextDelay(prev: number, outcome: 'changed' | 'same' | 'error'): number {
  if (outcome === 'changed') return POLL_MIN_MS;
  if (outcome === 'same') return Math.min(POLL_MAX_MS, Math.round(prev * 1.5));
  return Math.min(POLL_ERROR_MAX_MS, prev * 2);
}

export function isInFlight(status: string): boolean {
  return status === 'queued' || status === 'processing';
}
