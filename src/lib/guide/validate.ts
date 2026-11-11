import { guideSchema, migrateGuide, type Guide, type Guidance } from './schema';

export type IssueSeverity = 'info' | 'warning';

export interface GuideIssue {
  code: string;
  /** Dotted path into the guide, e.g. `steps.s2.why`. */
  path: string;
  message: string;
  severity: IssueSeverity;
}

export interface GuideError {
  code: string;
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; guide: Guide; issues: GuideIssue[] }
  | { ok: false; errors: GuideError[] };

export interface ValidateOptions {
  pageCount: number;
  /** Plain text of each page (index = pageIndex). When given, every sourceQuote is checked against its step's pages. */
  pageTexts?: string[];
}

const normaliseText = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const isBlank = (q: string | undefined) => q !== undefined && q.trim() === '';

/** Smallest region side (fraction of the page) that is still treated as a real area. */
export const MIN_REGION_SIDE = 0.01;

const NUMBER_WORDS = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'hundreds', 'thousand',
  'half', 'halves', 'quarter', 'quarters', 'third', 'thirds', 'dozen', 'dozens', 'twice', 'double', 'triple', 'pair', 'pairs', 'couple', 'several',
].join('|');
const QUANTITY_RE = new RegExp(`\\p{N}|\\b(?:${NUMBER_WORDS})\\b`, 'iu');

/** True when the text contains any Unicode numeric character or a spelled-out quantity ("two screws", "half"). */
export function containsQuantity(text: string): boolean {
  return QUANTITY_RE.test(text);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Clamps every `region` found anywhere in the raw guide to 0..1. A region that is degenerate
 * (non-finite, non-positive or tiny after clamping) is removed and its parent gets `regionFallback: true`.
 * Mutates the (already cloned) input.
 */
function normaliseRegions(node: unknown, path: string, issues: GuideIssue[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => normaliseRegions(child, `${path}[${i}]`, issues));
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === 'region' && isRecord(value)) {
      const { x, y, w, h } = value;
      const nums = [x, y, w, h];
      if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n)) || (w as number) <= 0 || (h as number) <= 0) {
        delete node.region;
        node.regionFallback = true;
        issues.push({ code: 'region_dropped', path: childPath, severity: 'warning', message: 'Region is not a valid rectangle; dropped and marked as approximate.' });
        continue;
      }
      const left = clamp01(x as number);
      const top = clamp01(y as number);
      const right = clamp01((x as number) + (w as number));
      const bottom = clamp01((y as number) + (h as number));
      const next = { x: round6(left), y: round6(top), w: round6(right - left), h: round6(bottom - top) };
      if (next.w < MIN_REGION_SIDE || next.h < MIN_REGION_SIDE) {
        delete node.region;
        node.regionFallback = true;
        issues.push({ code: 'region_dropped', path: childPath, severity: 'warning', message: 'Region is degenerate after clamping; dropped and marked as approximate.' });
        continue;
      }
      const moved = (a: number, b: unknown) => Math.abs(a - (b as number)) > 1e-6;
      if (moved(next.x, x) || moved(next.y, y) || moved(next.w, w) || moved(next.h, h)) {
        issues.push({ code: 'region_clamped', path: childPath, severity: 'info', message: 'Region extended beyond the page and was clamped.' });
      }
      node.region = next;
    } else {
      normaliseRegions(value, childPath, issues);
    }
  }
}

/** Parses, checks and normalises a raw guide. Pure: no I/O. */
export function validateGuide(raw: unknown, opts: ValidateOptions): ValidationResult {
  const migrated = migrateGuide(raw);
  if (!migrated.ok) return { ok: false, errors: [{ code: 'schema_version', path: 'schemaVersion', message: migrated.error }] };

  const issues: GuideIssue[] = [];
  const clone = structuredClone(migrated.raw);
  normaliseRegions(clone, '', issues);

  const parsed = guideSchema.safeParse(clone);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message })),
    };
  }
  const guide = parsed.data;
  const errors: GuideError[] = [];
  const err = (code: string, path: string, message: string) => errors.push({ code, path, message });
  const issue = (code: string, path: string, message: string, severity: IssueSeverity = 'warning') => issues.push({ code, path, message, severity });
  const validPage = (n: number) => Number.isInteger(n) && n >= 0 && n < opts.pageCount;

  // --- id uniqueness and resolution ---------------------------------------------------------
  const unique = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) err('duplicate_id', kind, `Duplicate ${kind} id "${id}".`);
      seen.add(id);
    }
    return seen;
  };
  const partIds = unique('parts', guide.parts.map((p) => p.id));
  const toolIds = unique('tools', guide.tools.map((t) => t.id));
  const phaseIds = unique('phases', guide.phases.map((p) => p.id));
  const stepIds = new Set(Object.keys(guide.steps));

  for (const [key, step] of Object.entries(guide.steps)) {
    if (step.id !== key) err('step_key_mismatch', `steps.${key}.id`, `Step key "${key}" does not match its id "${step.id}".`);
  }

  // --- parts / tools sources ----------------------------------------------------------------
  guide.parts.forEach((p, i) => {
    if (!validPage(p.source.pageIndex)) err('invalid_page', `parts[${i}].source.pageIndex`, `Part "${p.id}" references page ${p.source.pageIndex}, outside 0..${opts.pageCount - 1}.`);
  });
  guide.tools.forEach((t, i) => {
    if (t.source && !validPage(t.source.pageIndex)) err('invalid_page', `tools[${i}].source.pageIndex`, `Tool "${t.id}" references an invalid page.`);
  });
  guide.glossary.forEach((g, i) => {
    if (g.source && !validPage(g.source.pageIndex)) {
      delete g.source;
      issue('source_dropped', `glossary[${i}].source`, 'Glossary source referenced an invalid page and was removed.');
    }
  });
  guide.unreadablePages = guide.unreadablePages.filter((u, i) => {
    if (validPage(u.pageIndex)) return true;
    issue('unreadable_page_dropped', `unreadablePages[${i}]`, `Unreadable page ${u.pageIndex} is outside the document and was removed.`);
    return false;
  });

  // --- phases cover every step exactly once --------------------------------------------------
  const owner = new Map<string, string>();
  for (const phase of guide.phases) {
    for (const sid of phase.stepIds) {
      if (!stepIds.has(sid)) err('unknown_step', `phases.${phase.id}.stepIds`, `Phase "${phase.id}" lists unknown step "${sid}".`);
      else if (owner.has(sid)) err('step_repeated', `phases.${phase.id}.stepIds`, `Step "${sid}" appears more than once across phases.`);
      else owner.set(sid, phase.id);
    }
  }
  for (const sid of stepIds) {
    if (!owner.has(sid)) err('step_not_in_phase', `steps.${sid}`, `Step "${sid}" is not listed in any phase.`);
  }

  // --- per-step rules -------------------------------------------------------------------------
  for (const [sid, step] of Object.entries(guide.steps)) {
    const p = `steps.${sid}`;
    if (!phaseIds.has(step.phaseId)) err('unknown_phase', `${p}.phaseId`, `Step "${sid}" references unknown phase "${step.phaseId}".`);
    else if (owner.has(sid) && owner.get(sid) !== step.phaseId) err('phase_mismatch', `${p}.phaseId`, `Step "${sid}" says phase "${step.phaseId}" but is listed in "${owner.get(sid)}".`);

    for (const pu of step.partsUsed) if (!partIds.has(pu.partId)) err('unknown_part', `${p}.partsUsed`, `Step "${sid}" uses unknown part "${pu.partId}".`);
    for (const tid of step.toolsUsed) if (!toolIds.has(tid)) err('unknown_tool', `${p}.toolsUsed`, `Step "${sid}" uses unknown tool "${tid}".`);

    // Sources: every step needs >= 1 source on a real page.
    const goodSources = step.sources.filter((s) => validPage(s.pageIndex));
    if (goodSources.length < step.sources.length && goodSources.length > 0) {
      issue('source_dropped', `${p}.sources`, `Removed ${step.sources.length - goodSources.length} source(s) with an invalid page index.`);
    }
    if (goodSources.length === 0) err('no_valid_source', `${p}.sources`, `Step "${sid}" has no source with a valid page index.`);
    step.sources = goodSources;

    // Quotes: blank quotes are not quotes; with page text available, quotes must really appear on the step's pages.
    const pageHay = opts.pageTexts ? goodSources.map((src) => normaliseText(opts.pageTexts?.[src.pageIndex] ?? '')) : undefined;
    let stepQuoteRemoved = false;
    const checkQuote = (q: string | undefined, qPath: string): string | undefined => {
      if (q === undefined) return undefined;
      if (isBlank(q)) {
        issue('blank_quote_removed', qPath, 'A blank source quote was removed.');
        return undefined;
      }
      if (pageHay && !pageHay.some((h) => h.includes(normaliseText(q)))) {
        issue('quote_not_found', qPath, 'Source quote does not appear on the step\'s source pages and was removed.');
        if (qPath === `${p}.sourceQuote`) stepQuoteRemoved = true;
        return undefined;
      }
      return q;
    };
    step.sourceQuote = checkQuote(step.sourceQuote, `${p}.sourceQuote`);
    step.warnings.forEach((w, i) => (w.sourceQuote = checkQuote(w.sourceQuote, `${p}.warnings[${i}].sourceQuote`)));
    for (const field of ['why', 'commonMistake', 'checkpoint'] as const) {
      const g = step[field];
      if (g) g.sourceQuote = checkQuote(g.sourceQuote, `${p}.${field}.sourceQuote`);
    }
    if (stepQuoteRemoved && step.confidence !== 'low') step.confidence = 'low';

    // Highlights: must carry a valid page and resolvable part ids.
    step.highlights = step.highlights.filter((h, i) => {
      if (!validPage(h.source.pageIndex)) {
        issue('highlight_dropped', `${p}.highlights[${i}]`, 'Highlight referenced an invalid page and was removed.');
        return false;
      }
      if (h.partId !== undefined && !partIds.has(h.partId)) {
        err('unknown_part', `${p}.highlights[${i}].partId`, `Highlight references unknown part "${h.partId}".`);
      }
      return true;
    });

    // Warnings: a worded warning needs a verbatim quote; otherwise it is an interpretation.
    step.warnings.forEach((w, i) => {
      if (!w.sourceQuote && !w.interpretedFromDiagram) {
        w.interpretedFromDiagram = true;
        issue('warning_without_quote', `${p}.warnings[${i}]`, 'Warning has no source quote; it is now labelled as interpreted from a diagram.');
      }
    });

    // Guidance provenance.
    for (const field of ['why', 'commonMistake', 'checkpoint'] as const) {
      const g: Guidance | undefined = step[field];
      if (!g) continue;
      if (g.origin === 'manual' && !g.sourceQuote) {
        g.origin = 'inferred';
        issue('manual_without_quote', `${p}.${field}`, 'Guidance claimed to be from the manual but has no source quote; relabelled as inferred.');
      }
      if (g.origin === 'inferred') {
        if (containsQuantity(g.text)) {
          delete step[field];
          issue('inferred_quantity_stripped', `${p}.${field}`, 'Inferred guidance contained a number or quantity and was removed (measurements must come from the manual).');
        } else {
          if (g.sourceQuote !== undefined) {
            delete g.sourceQuote;
            issue('inferred_quote_removed', `${p}.${field}`, 'Inferred guidance carried a source quote; the quote was removed.');
          }
        }
      }
    }

    // Numbers in the step need a verbatim quote, otherwise we cannot show where they came from.
    if (!step.sourceQuote && containsQuantity(`${step.title} ${step.instruction}`)) {
      if (step.confidence !== 'low') step.confidence = 'low';
      issue('numbers_without_quote', p, 'Step text contains numbers or quantities but has no source quote; confidence set to low.');
    }
  }

  if (!opts.pageTexts) issue('quotes_unverified', '', 'Quotes not verified against page text.', 'info');

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, guide, issues };
}
