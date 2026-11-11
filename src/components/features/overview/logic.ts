import { getOwn, orderedSteps } from '@/lib/guide/selectors';
import type { Region } from '@/lib/guide/schema';
import type { ValidatedGuide } from '@/lib/guide/validate';
import type { ChecklistState, GuideProgress } from '@/lib/client/guide-store';

export type ItemKind = 'tool' | 'part';

export interface NeededStep {
  /** 1-based position in manual order. */
  n: number;
  id: string;
}

/** Steps (manual order) that use the given part or tool. */
export function stepsNeeding(guide: ValidatedGuide, kind: ItemKind, itemId: string): NeededStep[] {
  const out: NeededStep[] = [];
  orderedSteps(guide).forEach((s, i) => {
    const uses = kind === 'part' ? s.partsUsed.some((p) => p.partId === itemId) : s.toolsUsed.includes(itemId);
    if (uses) out.push({ n: i + 1, id: s.id });
  });
  return out;
}

export interface ChecklistCounts {
  total: number;
  have: number;
  missing: number;
  unchecked: number;
  missingParts: number;
  missingTools: number;
}

export function checklistCounts(guide: ValidatedGuide, checklist: Record<string, ChecklistState>): ChecklistCounts {
  const c: ChecklistCounts = { total: 0, have: 0, missing: 0, unchecked: 0, missingParts: 0, missingTools: 0 };
  const visit = (id: string, kind: ItemKind) => {
    c.total += 1;
    const s = getOwn(checklist, id) ?? 'unchecked';
    if (s === 'have') c.have += 1;
    else if (s === 'missing') {
      c.missing += 1;
      if (kind === 'part') c.missingParts += 1;
      else c.missingTools += 1;
    } else c.unchecked += 1;
  };
  guide.tools.forEach((t) => visit(t.id, 'tool'));
  guide.parts.forEach((p) => visit(p.id, 'part'));
  return c;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "7 of 12 checked" / "Everything checked" / "1 part marked missing". Empty when the manual lists nothing. */
export function readinessLine(c: ChecklistCounts): string {
  if (c.total === 0) return '';
  if (c.missing > 0) {
    if (c.missingTools === 0) return `${c.missing} ${plural(c.missing, 'part', 'parts')} marked missing`;
    if (c.missingParts === 0) return `${c.missing} ${plural(c.missing, 'tool', 'tools')} marked missing`;
    return `${c.missing} items marked missing`;
  }
  if (c.have === c.total) return 'Everything checked';
  return `${c.have} of ${c.total} checked`;
}

/** Union of the steps that need any of the missing items, in manual order. */
export function blockedSteps(guide: ValidatedGuide, checklist: Record<string, ChecklistState>): NeededStep[] {
  const seen = new Map<string, NeededStep>();
  const add = (kind: ItemKind, id: string) => {
    if (getOwn(checklist, id) !== 'missing') return;
    for (const s of stepsNeeding(guide, kind, id)) seen.set(s.id, s);
  };
  guide.tools.forEach((t) => add('tool', t.id));
  guide.parts.forEach((p) => add('part', p.id));
  return [...seen.values()].sort((a, b) => a.n - b.n);
}

/** "You can do steps 1-3 before you need it." (USER_FLOWS 10.4 item 2). */
export function missingSentence(blocked: NeededStep[], missingCount: number): string {
  const first = blocked[0];
  if (!first || missingCount === 0) return '';
  const it = missingCount === 1 ? 'it' : 'them';
  if (first.n === 1) return `You need ${it} from the first step.`;
  if (first.n === 2) return `You can do step 1 before you need ${it}.`;
  return `You can do steps 1-${first.n - 1} before you need ${it}.`;
}

/** "4", "4 and 9", "4, 9 and 12". */
export function numberList(ns: number[]): string {
  if (ns.length <= 1) return ns.join('');
  return `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

export type StartMode = 'start' | 'continue' | 'review';

export interface StartTarget {
  mode: StartMode;
  stepId: string;
  /** 1-based step number of `stepId`. */
  n: number;
  label: string;
  href: string;
}

/** Where the primary action goes: the saved step, else the first not-done step, else the first step. */
export function startTarget(guideId: string, guide: ValidatedGuide, progress: GuideProgress): StartTarget {
  const steps = orderedSteps(guide);
  const done = new Set(progress.completedStepIds.filter((id) => getOwn(guide.steps, id)));
  const finished = steps.length > 0 && done.size >= steps.length;
  const saved = progress.currentStepId && getOwn(guide.steps, progress.currentStepId) ? progress.currentStepId : null;
  const firstOpen = steps.find((s) => !done.has(s.id)) ?? steps[0];
  const id = finished ? steps[0]!.id : (saved ?? firstOpen!.id);
  const n = steps.findIndex((s) => s.id === id) + 1;
  const started = done.size > 0 || saved !== null;
  const mode: StartMode = finished ? 'review' : started ? 'continue' : 'start';
  const label = mode === 'review' ? 'Review steps' : mode === 'continue' ? `Continue at step ${n}` : 'Start';
  return { mode, stepId: id, n, label, href: playHref(guideId, id) };
}

export const playHref = (guideId: string, stepId: string) => `/g/${encodeURIComponent(guideId)}/play?step=${encodeURIComponent(stepId)}`;
/** `page` is 1-based. */
export const originalHref = (guideId: string, page = 1) => `/g/${encodeURIComponent(guideId)}/play?panel=original&page=${page}`;

/** 1-based pages for `/new?again=`; page numbers, deduplicated and sorted. */
export function againHref(unreadablePageIndexes: number[]): string {
  const pages = [...new Set(unreadablePageIndexes.map((i) => i + 1))].sort((a, b) => a - b);
  return pages.length ? `/new?again=${pages.join(',')}` : '/new';
}

export const difficultyLabel = (d: 1 | 2 | 3) => (d === 1 ? 'Easy' : d === 2 ? 'Moderate' : 'Demanding');

export const isDemoGuide = (guide: ValidatedGuide) => guide.category === 'demo';

/**
 * Inline style that shows the `region` of a page image inside a square box of `size` px: the page keeps its
 * proportions and is only scaled and shifted (never recoloured). `aspect` = natural height / width.
 */
export function cropStyle(region: Region, aspect: number, size: number) {
  const width = Math.min(size / region.w, size / (region.h * aspect));
  const height = width * aspect;
  return {
    width,
    height,
    left: -region.x * width + (size - region.w * width) / 2,
    top: -region.y * height + (size - region.h * height) / 2,
  };
}
