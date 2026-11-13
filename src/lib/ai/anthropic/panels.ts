import type { DetectedPanel } from '../provider';
import type { SourceRef } from '../../guide/schema';
import type { ModelGuide } from './schemas';

export type PanelsByPage = ReadonlyMap<number, readonly DetectedPanel[]>;

export function panelsByPage(input: { pageIndex: number; panels: DetectedPanel[] }[] | undefined): PanelsByPage {
  const m = new Map<number, readonly DetectedPanel[]>();
  for (const p of input ?? []) if (p.panels.length > 0) m.set(p.pageIndex, p.panels);
  return m;
}

/**
 * Makes every source reference honest about where it points (ARCHITECTURE section 10, item 3):
 * a `panelId` the model chose from the provided list is kept and its region is taken from the code-detected panel;
 * an unknown or missing panel (or a page without a panel list) drops the id and flags `regionFallback`, so the UI
 * says the area is approximate. Model-drawn regions are never presented as exact.
 */
export function resolveSourceRef(ref: SourceRef, panels: PanelsByPage): SourceRef {
  const list = panels.get(ref.pageIndex);
  const panel = ref.panelId !== undefined ? list?.find((p) => p.panelId === ref.panelId) : undefined;
  if (panel) return { pageIndex: ref.pageIndex, panelId: panel.panelId, region: panel.region, regionFallback: false };
  const { panelId: _dropped, ...rest } = ref;
  void _dropped;
  return { ...rest, regionFallback: true };
}

export function resolvePanels(guide: ModelGuide, panels: PanelsByPage): ModelGuide {
  const r = (s: SourceRef) => resolveSourceRef(s, panels);
  return {
    ...guide,
    parts: guide.parts.map((p) => ({ ...p, source: r(p.source) })),
    tools: guide.tools.map((t) => (t.source ? { ...t, source: r(t.source) } : t)),
    glossary: guide.glossary.map((g) => (g.source ? { ...g, source: r(g.source) } : g)),
    steps: guide.steps.map((s) => ({
      ...s,
      sources: s.sources.map(r),
      highlights: s.highlights.map((h) => ({ ...h, source: r(h.source) })),
    })),
  };
}
