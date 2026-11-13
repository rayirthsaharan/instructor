import { findIntroducedQuantities } from '../../src/lib/guide/quantity';
import { orderedSteps } from '../../src/lib/guide/selectors';
import type { Region, SourceRef, Step } from '../../src/lib/guide/schema';
import type { ValidatedGuide } from '../../src/lib/guide/validate';
import type { AnswerKey, KeyPart, KeyStep } from './key-schema';

/** Thresholds for "right diagram region" (docs/ACCURACY_TEST_PLAN.md section 5.4). */
export const REGION_RULES = {
  /** The chosen region must contain at least this share of the key region. */
  minCoverage: 0.8,
  /** ...and be at most this many times its area; larger but covering is "coarse" (safe, not counted as right). */
  maxAreaRatio: 2.5,
} as const;

/** Pass bar from REAL_MODEL_PROPOSAL section 2 (applied per run, and must hold on every repeat). */
export const PASS_BAR = { minRegionCorrectShare: 0.9 } as const;

export type RegionVerdict =
  /** Right page, chosen panel covers the key diagram and is not much larger. */
  | 'correct'
  /** Right page, covers the key diagram but is more than `maxAreaRatio` times larger (shows too much; still safe). */
  | 'coarse'
  /** Right page, flagged `regionFallback` with an approximate box that still covers the key diagram. */
  | 'approximate'
  /** Right page, no region: the whole page is shown and labelled as such. Safe. */
  | 'fallback'
  /** Wrong page, or a region that misses the key diagram. The failure the pass bar forbids. */
  | 'wrong';

export type PanelLookup = ReadonlyMap<number, readonly { panelId: string; region: Region }[]>;

const area = (r: Region) => r.w * r.h;
function intersection(a: Region, b: Region): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Share of `key` inside `pred`, and `pred`'s area relative to `key`. */
export function regionOverlap(pred: Region, key: Region): { coverage: number; areaRatio: number } {
  return { coverage: intersection(pred, key) / area(key), areaRatio: area(pred) / area(key) };
}

/** Region shown for a source: its own region, or the region of the code-detected panel it names. */
export function resolveRegion(src: SourceRef, panels?: PanelLookup): Region | undefined {
  if (src.region) return src.region;
  if (src.panelId === undefined) return undefined;
  return panels?.get(src.pageIndex)?.find((p) => p.panelId === src.panelId)?.region;
}

/**
 * Scores the first source of a step: it is what the player shows first (DESIGN_SYSTEM "source visual"), so a right
 * diagram listed second does not rescue a wrong first one.
 */
export function classifyRegion(src: SourceRef | undefined, keyStep: KeyStep, panels?: PanelLookup): RegionVerdict {
  if (!src) return 'wrong';
  const targets = [{ pageIndex: keyStep.pageIndex, region: keyStep.region }, ...keyStep.altRegions].filter((t) => t.pageIndex === src.pageIndex);
  if (targets.length === 0) return 'wrong';
  const region = resolveRegion(src, panels);
  if (!region) return 'fallback';
  const best = targets.map((t) => regionOverlap(region, t.region)).sort((a, b) => b.coverage - a.coverage || a.areaRatio - b.areaRatio)[0]!;
  if (best.coverage < REGION_RULES.minCoverage) return 'wrong';
  if (src.regionFallback) return 'approximate';
  return best.areaRatio <= REGION_RULES.maxAreaRatio ? 'correct' : 'coarse';
}

const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const WARNING_PREFIX = /^(warning|caution|danger|important|note|advertencia|precaución|precaucion|atención|atencion|peligro|aviso)\s*[:!.-]\s*/u;
const normWarning = (s: string) => norm(s).replace(WARNING_PREFIX, '').replace(/[.!]+$/, '').trim();

function partMatches(draft: { name: string; manualLabel?: string }, key: KeyPart): 'label' | 'name' | undefined {
  if (key.label && draft.manualLabel && norm(draft.manualLabel) === norm(key.label)) return 'label';
  const n = norm(draft.name);
  if (key.names.some((a) => {
    const alias = norm(a);
    return n === alias || (alias.length >= 3 && n.includes(alias)) || (n.length >= 3 && alias.includes(n));
  })) return 'name';
  return undefined;
}

function stepText(step: Step): string {
  return norm(`${step.title} ${step.instruction}`);
}

/** Length of the longest strictly increasing subsequence. */
function lis(xs: number[]): number {
  const tails: number[] = [];
  for (const x of xs) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = x;
  }
  return tails.length;
}

export interface StepScore {
  keyStep: number;
  draftStepId?: string;
  region: RegionVerdict | 'missed';
}

export interface ManualScore {
  parts: { key: number; matched: number; missed: string[]; invented: string[]; quantityErrors: string[]; quantityMissing: number };
  steps: { key: number; mapped: number; missed: number[]; extra: string[]; orderErrors: number; detail: StepScore[] };
  warnings: { key: number; verbatim: number; paraphrasedOnly: string[]; missing: string[] };
  regions: Record<RegionVerdict | 'missed', number> & { correctShare: number };
  /** Quantities in the guide text that appear on no page; `null` when the manual has no page text to check against. */
  inventedQuantities: string[] | null;
}

/** Scores a validated guide against its answer key. Pure. */
export function scoreGuide(guide: ValidatedGuide, key: AnswerKey, opts: { pageTexts?: string[]; panels?: PanelLookup } = {}): ManualScore {
  // Parts: label matches first, then names; one key part per draft part.
  const unmatchedKey = new Map(key.parts.map((p) => [p.key, p]));
  const matchedPairs: { draft: (typeof guide.parts)[number]; key: KeyPart }[] = [];
  const invented: string[] = [];
  const pending = [...guide.parts];
  for (const pass of ['label', 'name'] as const) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const d = pending[i]!;
      const hit = [...unmatchedKey.values()].find((k) => partMatches(d, k) === pass || (pass === 'name' && partMatches(d, k) !== undefined));
      if (hit) {
        matchedPairs.push({ draft: d, key: hit });
        unmatchedKey.delete(hit.key);
        pending.splice(i, 1);
      }
    }
  }
  for (const d of pending) invented.push(d.manualLabel ? `${d.name} (${d.manualLabel})` : d.name);
  const quantityErrors: string[] = [];
  let quantityMissing = 0;
  for (const { draft, key: k } of matchedPairs) {
    if (k.quantity === undefined) continue;
    if (draft.quantity === undefined) quantityMissing++;
    else if (draft.quantity !== k.quantity) quantityErrors.push(`${k.key}: ${draft.quantity} instead of ${k.quantity}`);
  }

  // Steps: map each model step onto at most one key step by page + anchors; never by region (scored separately).
  const ordered = orderedSteps(guide);
  const freeKey = new Map(key.steps.map((s) => [s.n, s]));
  const mapping = new Map<string, KeyStep>();
  for (const step of ordered) {
    const pages = new Set(step.sources.map((s) => s.pageIndex));
    const text = stepText(step);
    const candidates = [...freeKey.values()].filter(
      (k) => (pages.has(k.pageIndex) || k.altRegions.some((a) => pages.has(a.pageIndex))) && k.anchors.every((g) => g.some((a) => text.includes(norm(a)))),
    );
    candidates.sort((a, b) => b.anchors.length - a.anchors.length || a.n - b.n);
    const hit = candidates[0];
    if (hit) {
      mapping.set(step.id, hit);
      freeKey.delete(hit.n);
    }
  }
  const mappedSeq = ordered.filter((s) => mapping.has(s.id)).map((s) => mapping.get(s.id)!.n);
  const detail: StepScore[] = key.steps.map((k) => {
    const draft = ordered.find((s) => mapping.get(s.id)?.n === k.n);
    return draft ? { keyStep: k.n, draftStepId: draft.id, region: classifyRegion(draft.sources[0], k, opts.panels) } : { keyStep: k.n, region: 'missed' as const };
  });

  // Warnings: verbatim means the key text (prefix and end punctuation aside) is inside a warning's sourceQuote.
  const allWarnings = ordered.flatMap((s) => s.warnings);
  const quotes = allWarnings.map((w) => normWarning(w.sourceQuote ?? ''));
  const texts = allWarnings.map((w) => normWarning(w.text));
  let verbatim = 0;
  const paraphrasedOnly: string[] = [];
  const missing: string[] = [];
  for (const w of key.warnings) {
    const k = normWarning(w.text);
    if (quotes.some((q) => q.length > 0 && q.includes(k))) verbatim++;
    else if (texts.some((t) => t.includes(k))) paraphrasedOnly.push(w.text);
    else missing.push(w.text);
  }

  const regions = { correct: 0, coarse: 0, approximate: 0, fallback: 0, wrong: 0, missed: 0, correctShare: 0 };
  for (const d of detail) regions[d.region]++;
  regions.correctShare = key.steps.length > 0 ? regions.correct / key.steps.length : 0;

  let inventedQuantities: string[] | null = null;
  if (opts.pageTexts && opts.pageTexts.some((t) => t.trim() !== '')) {
    const evidence = opts.pageTexts;
    const found = new Set<string>();
    const check = (text: string | undefined) => {
      if (text) for (const q of findIntroducedQuantities(evidence, text)) found.add(q);
    };
    for (const s of ordered) {
      check(s.title);
      check(s.instruction);
      for (const w of s.warnings) check(w.text);
      for (const g of [s.why, s.commonMistake, s.checkpoint]) check(g?.text);
    }
    for (const p of guide.parts) check(p.name);
    inventedQuantities = [...found];
  }

  return {
    parts: { key: key.parts.length, matched: matchedPairs.length, missed: [...unmatchedKey.keys()], invented, quantityErrors, quantityMissing },
    steps: { key: key.steps.length, mapped: mapping.size, missed: detail.filter((d) => d.region === 'missed').map((d) => d.keyStep), extra: ordered.filter((s) => !mapping.has(s.id)).map((s) => s.id), orderErrors: mappedSeq.length - lis(mappedSeq), detail },
    warnings: { key: key.warnings.length, verbatim, paraphrasedOnly, missing },
    regions,
    inventedQuantities,
  };
}

export interface PassVerdict {
  pass: boolean;
  reasons: string[];
}

/** The proposal's pass bar for one run. A rejected guide (no validated guide at all) fails. */
export function passBar(score: ManualScore | undefined): PassVerdict {
  if (!score) return { pass: false, reasons: ['no validated guide'] };
  const reasons: string[] = [];
  if (score.parts.invented.length > 0) reasons.push(`invented parts: ${score.parts.invented.join(', ')}`);
  if (score.parts.quantityErrors.length > 0) reasons.push(`quantity errors: ${score.parts.quantityErrors.join(', ')}`);
  if (score.inventedQuantities === null) reasons.push('invented measurements not measurable (no page text)');
  else if (score.inventedQuantities.length > 0) reasons.push(`invented measurements: ${score.inventedQuantities.join(', ')}`);
  if (score.warnings.verbatim < score.warnings.key) reasons.push(`warnings not verbatim: ${score.warnings.key - score.warnings.verbatim} of ${score.warnings.key}`);
  if (score.regions.wrong > 0) reasons.push(`wrong diagram region on ${score.regions.wrong} step(s)`);
  if (score.regions.correctShare < PASS_BAR.minRegionCorrectShare) reasons.push(`right region on ${(score.regions.correctShare * 100).toFixed(0)}% of steps (bar ${PASS_BAR.minRegionCorrectShare * 100}%)`);
  return { pass: reasons.length === 0, reasons };
}
