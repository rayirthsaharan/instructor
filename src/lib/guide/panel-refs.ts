import type { Guide, Region, SourceRef } from './schema';

/** Detected panels per page (by `pageIndex`), as stored by the pipeline. */
export type PanelsByPage = ReadonlyMap<number, readonly { panelId: string; region: Region }[]>;

const contains = (outer: Region, inner: Region) => inner.x >= outer.x - 1e-6 && inner.y >= outer.y - 1e-6 && inner.x + inner.w <= outer.x + outer.w + 1e-6 && inner.y + inner.h <= outer.y + outer.h + 1e-6;

/**
 * Makes one source reference honest about where it points (ARCHITECTURE section 10, item 3). A `panelId` that exists on
 * that page takes its region from the stored, code-detected panel. A highlight keeps its own smaller region when it lies
 * inside that panel. Anything else (no id, an id that is not on the page, a page without panels) becomes the whole page
 * with `regionFallback: true`: the model's own coordinates are never shown as a located area.
 */
export function resolveRef(ref: SourceRef, panels: PanelsByPage, highlight = false): SourceRef {
  const panel = ref.panelId === undefined ? undefined : panels.get(ref.pageIndex)?.find((p) => p.panelId === ref.panelId);
  if (!panel) return { pageIndex: ref.pageIndex, regionFallback: true };
  const keepOwn = highlight && ref.region !== undefined && contains(panel.region, ref.region);
  return { pageIndex: ref.pageIndex, panelId: panel.panelId, region: keepOwn ? ref.region : panel.region, regionFallback: false };
}

/** Counts of references resolved to a panel and left as whole-page fallbacks; mutates `guide`. */
export function resolveGuidePanels(guide: Guide, panels: PanelsByPage): { resolved: number; fallback: number } {
  let resolved = 0;
  let fallback = 0;
  const apply = <T extends { source?: SourceRef }>(o: T, highlight = false) => {
    if (!o.source) return;
    o.source = resolveRef(o.source, panels, highlight);
    if (o.source.panelId) resolved++; else fallback++;
  };
  guide.parts.forEach((p) => apply(p));
  guide.tools.forEach((t) => apply(t));
  guide.glossary.forEach((g) => apply(g));
  for (const step of Object.values(guide.steps)) {
    step.sources = step.sources.map((s) => {
      const r = resolveRef(s, panels);
      if (r.panelId) resolved++; else fallback++;
      return r;
    });
    step.highlights.forEach((h) => apply(h, true));
  }
  return { resolved, fallback };
}
