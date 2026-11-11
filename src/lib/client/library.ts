import { isInFlight } from './poll';
import type { GuideSummary } from './types';

export type CardState = 'processing' | 'failed' | 'ready' | 'inProgress' | 'finished';

/** Card state from the list entry (DS 7.2). */
export function libraryState(g: Pick<GuideSummary, 'status' | 'stepCount' | 'progress'>): CardState {
  if (isInFlight(g.status)) return 'processing';
  if (g.status === 'failed' || g.status === 'rejected') return 'failed';
  const done = g.progress.completedCount;
  if (g.stepCount > 0 && done >= g.stepCount) return 'finished';
  if (done > 0) return 'inProgress';
  return 'ready';
}

/** Where a card goes (USER_FLOWS 2): unfinished -> player, not started / finished -> overview, others -> Processing. */
export function guideHref(g: GuideSummary): string {
  if (!g.id) return `/d/${g.documentId}`;
  switch (libraryState(g)) {
    case 'processing':
    case 'failed':
      return `/d/${g.documentId}`;
    case 'inProgress':
      return `/g/${g.id}/play`;
    default:
      return `/g/${g.id}`;
  }
}

/** The most recently used unfinished guide (list is expected newest first; we sort defensively). */
export function hero(sorted: GuideSummary[]): GuideSummary | null {
  return sorted.find((g) => libraryState(g) === 'inProgress') ?? null;
}

/** Newest first; tolerates epoch ms or ISO strings. */
export function updatedAtMs(g: Pick<GuideSummary, 'updatedAt'>): number {
  return typeof g.updatedAt === 'number' ? g.updatedAt : Date.parse(g.updatedAt) || 0;
}
export const byRecent = (a: GuideSummary, b: GuideSummary) => updatedAtMs(b) - updatedAtMs(a);
