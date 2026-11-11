import type { Part, Step } from '@/lib/guide/schema';
import { isUsableRegion, type Rect } from './geometry';

/** One drawn marking: a highlight with a usable region, or the step's own source region when nothing else marks it. */
export interface MarkView {
  key: string;
  /** 1-based index in `step.highlights`; null for the step's own region (no callout). */
  number: number | null;
  /** Text inside the callout: a short manual label ("A") or the number. */
  callout: string | null;
  label?: string;
  partId?: string;
  region: Rect;
  approximate: boolean;
  /** "Marked area 1: Cam lock (part B)" (DS 7.10). */
  description: string;
}

/** One entry of the pager: a source of the step, or a page referenced only by a highlight. */
export interface VisualPage {
  pageIndex: number;
  /** Region to fit the view to; undefined means the whole page. */
  region?: Rect;
  approximate: boolean;
  marks: MarkView[];
}

const SHORT_LABEL = 2;

function describe(n: number | null, label: string | undefined, part: Part | undefined): string {
  const name = label?.trim() || part?.name;
  const partText = part ? (part.manualLabel ? ` (part ${part.manualLabel})` : '') : '';
  if (n === null) return name ? `Marked area: ${name}${partText}` : 'Marked area';
  return name ? `Marked area ${n}: ${name}${partText}` : `Marked area ${n}`;
}

/**
 * Pager pages of a step (USER_FLOWS 6.6): the step's `sources` in order, then any page referenced only by a
 * highlight. Each highlight is drawn on the page of its own source, never assumed to be `sources[0]`.
 */
export function visualPages(step: Pick<Step, 'sources' | 'highlights'>, parts: readonly Part[] = []): VisualPage[] {
  const pages: VisualPage[] = step.sources.map((s) => ({
    pageIndex: s.pageIndex,
    region: isUsableRegion(s.region) ? s.region : undefined,
    approximate: s.regionFallback === true,
    marks: [],
  }));
  for (const h of step.highlights) {
    if (!pages.some((p) => p.pageIndex === h.source.pageIndex)) {
      pages.push({ pageIndex: h.source.pageIndex, approximate: false, marks: [] });
    }
  }
  step.highlights.forEach((h, i) => {
    if (!isUsableRegion(h.source.region)) return; // nothing to draw: the page is still reachable in the pager
    const part = h.partId ? parts.find((p) => p.id === h.partId) : undefined;
    const n = i + 1;
    const label = h.label?.trim();
    const mark: MarkView = {
      key: `h${i}`,
      number: n,
      callout: label && label.length <= SHORT_LABEL ? label : String(n),
      label: h.label,
      partId: h.partId,
      region: h.source.region,
      approximate: h.source.regionFallback === true,
      description: describe(n, h.label, part),
    };
    for (const p of pages) if (p.pageIndex === h.source.pageIndex) p.marks.push(mark);
  });
  pages.forEach((p, i) => {
    if (p.region && (p.marks.length === 0 || p.approximate)) {
      p.marks.unshift({
        key: `s${i}`,
        number: null,
        callout: null,
        region: p.region,
        approximate: p.approximate,
        description: describe(null, undefined, undefined),
      });
    }
  });
  return pages;
}

/** Index of the pager page that shows the highlight for `partId`, or -1. */
export function pageForPart(pages: readonly VisualPage[], partId: string): number {
  return pages.findIndex((p) => p.marks.some((m) => m.partId === partId));
}

export type VisualTag = 'lowConfidence' | 'approximate' | 'wholePage' | null;

/** The single bottom-centre tag (DS 7.10): low confidence wins over approximate, which wins over whole page. */
export function visualTag(page: VisualPage, lowConfidence: boolean, marksVisible = true): VisualTag {
  if (lowConfidence) return 'lowConfidence';
  if (marksVisible && page.marks.some((m) => m.approximate)) return 'approximate';
  if (!page.region) return 'wholePage';
  return null;
}

/** Marks to draw on a single manual page in the Original viewer: those of every pager entry for that page. */
export function marksForPage(pages: readonly VisualPage[], pageIndex: number): MarkView[] {
  const out: MarkView[] = [];
  for (const p of pages) {
    if (p.pageIndex !== pageIndex) continue;
    for (const m of p.marks) if (!out.some((o) => o.key === m.key)) out.push(m);
  }
  return out;
}
