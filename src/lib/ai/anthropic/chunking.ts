import type { PageImage } from '../provider';
import type { Guide, Step } from '../../guide/schema';
import { badResponse } from './errors';
import type { ModelGuide } from './schemas';

/** Splits pages (kept in the given order) into consecutive groups of at most `size`. */
export function chunkPages<T>(pages: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < pages.length; i += n) out.push(pages.slice(i, i + n));
  return out;
}

export function chunkPrefix(chunkIndex: number): string {
  return `c${chunkIndex + 1}-`;
}

type DraftGuide = Omit<Guide, 'steps'> & { steps: Record<string, Step> };

/** Prefixes every id of one chunk's guide and every reference to them. Pure; does not touch page indices. */
export function prefixChunkIds(guide: ModelGuide, chunkIndex: number): ModelGuide {
  const p = chunkPrefix(chunkIndex);
  const pre = (id: string) => p + id;
  return {
    ...guide,
    tools: guide.tools.map((t) => ({ ...t, id: pre(t.id) })),
    parts: guide.parts.map((x) => ({ ...x, id: pre(x.id) })),
    phases: guide.phases.map((ph) => ({ ...ph, id: pre(ph.id), stepIds: ph.stepIds.map(pre) })),
    steps: guide.steps.map((s) => ({
      ...s,
      id: pre(s.id),
      phaseId: pre(s.phaseId),
      partsUsed: s.partsUsed.map((u) => ({ ...u, partId: pre(u.partId) })),
      toolsUsed: s.toolsUsed.map(pre),
      highlights: s.highlights.map((h) => (h.partId === undefined ? h : { ...h, partId: pre(h.partId) })),
    })),
  };
}

/**
 * Deterministic merge of chunk guides (in page order) into one draft with a `steps` map. Ids are chunk-prefixed first, so
 * they cannot collide. Document-level fields come from the first chunk, except: difficulty and peopleNeeded take the
 * maximum, safetyCritical is true if any chunk says so, estimatedMinutes is the sum only when every chunk gave one.
 * The result is untrusted and still goes through `validateGuide`.
 */
export function mergeChunkGuides(chunks: readonly { chunkIndex: number; guide: ModelGuide }[]): DraftGuide {
  if (chunks.length === 0) throw badResponse('no chunks to merge', false);
  const prefixed = chunks.map((c) => prefixChunkIds(c.guide, c.chunkIndex));
  const first = prefixed[0]!;
  const steps: Record<string, Step> = {};
  for (const g of prefixed) {
    for (const s of g.steps) {
      if (Object.prototype.hasOwnProperty.call(steps, s.id)) throw badResponse(`duplicate step id "${s.id}"`);
      steps[s.id] = s;
    }
  }
  const minutes = prefixed.map((g) => g.estimatedMinutes);
  const seenTerms = new Set<string>();
  const glossary = prefixed
    .flatMap((g) => g.glossary)
    .filter((e) => {
      const k = e.term.trim().toLowerCase();
      if (seenTerms.has(k)) return false;
      seenTerms.add(k);
      return true;
    });
  const merged: DraftGuide = {
    ...first,
    estimatedMinutes: minutes.every((m) => m !== undefined) ? minutes.reduce((a, b) => a + (b ?? 0), 0) : undefined,
    difficulty: Math.max(...prefixed.map((g) => g.difficulty)) as 1 | 2 | 3,
    peopleNeeded: Math.max(...prefixed.map((g) => g.peopleNeeded)),
    safetyCritical: prefixed.some((g) => g.safetyCritical),
    tools: prefixed.flatMap((g) => g.tools),
    parts: prefixed.flatMap((g) => g.parts),
    phases: prefixed.flatMap((g) => g.phases),
    steps,
    glossary,
    unreadablePages: prefixed.flatMap((g) => g.unreadablePages),
  };
  if (merged.estimatedMinutes === undefined) delete (merged as { estimatedMinutes?: number }).estimatedMinutes;
  return merged;
}

export interface PartMapping {
  keepId: string;
  duplicateIds: string[];
}

/**
 * Applies a parts-reconciliation result. The model only supplies id mappings; unknown ids, self-mappings, chains and
 * ids already merged are ignored, so a bad answer can only fail to merge, never lose a part that is still referenced.
 */
export function applyPartMappings(guide: DraftGuide, mappings: readonly PartMapping[]): DraftGuide {
  const known = new Set(guide.parts.map((p) => p.id));
  const remap = new Map<string, string>();
  const keepers = new Set<string>();
  for (const m of mappings) {
    if (!known.has(m.keepId) || remap.has(m.keepId)) continue;
    for (const d of m.duplicateIds) {
      if (d === m.keepId || !known.has(d) || remap.has(d) || keepers.has(d)) continue;
      remap.set(d, m.keepId);
      keepers.add(m.keepId);
    }
  }
  if (remap.size === 0) return guide;
  const to = (id: string) => remap.get(id) ?? id;
  const steps: Record<string, Step> = {};
  for (const [key, s] of Object.entries(guide.steps)) {
    const seen = new Set<string>();
    const partsUsed = s.partsUsed
      .map((u) => ({ ...u, partId: to(u.partId) }))
      .filter((u) => (seen.has(u.partId) ? false : (seen.add(u.partId), true)));
    steps[key] = { ...s, partsUsed, highlights: s.highlights.map((h) => (h.partId === undefined ? h : { ...h, partId: to(h.partId) })) };
  }
  return { ...guide, parts: guide.parts.filter((p) => !remap.has(p.id)), steps };
}
