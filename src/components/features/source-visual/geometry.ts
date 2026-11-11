// Pure geometry for the Source visual (DS 7.10). No DOM, no React: unit tested in tests/ui-m2-player-geometry.test.ts.
// Regions are normalised 0..1 rectangles of the page image. A Transform places the page in stage pixels:
// screen = (tx, ty) + normalised * (imgW, imgH) * s, where `s` is screen pixels per image pixel.

export interface Size {
  w: number;
  h: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Transform {
  tx: number;
  ty: number;
  s: number;
}

export const MAX_ZOOM = 5;
export const ZOOM_STEP = 1.5;
export const DOUBLE_TAP_ZOOM = 2.5;
/** Padding around a region, as a fraction of the page (DS 7.10). */
export const PAD = 0.06;
export const PAD_APPROXIMATE = 0.12;
/** A view counts as zoomed once it is more than this far above the fit scale. */
const ZOOM_EPSILON = 1.02;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The region padded by 6% of the page on each side (12% for an approximate region), clamped to the page. */
export function paddedRegion(region: Rect, approximate: boolean): Rect {
  const pad = approximate ? PAD_APPROXIMATE : PAD;
  const x0 = clamp(region.x - pad, 0, 1);
  const y0 = clamp(region.y - pad, 0, 1);
  const x1 = clamp(region.x + region.w + pad, 0, 1);
  const y1 = clamp(region.y + region.h + pad, 0, 1);
  return { x: x0, y: y0, w: Math.max(x1 - x0, 1e-6), h: Math.max(y1 - y0, 1e-6) };
}

/** A usable region is finite, positive and inside the page (small tolerance). */
export function isUsableRegion(r: Rect | undefined | null): r is Rect {
  if (!r) return false;
  const vals = [r.x, r.y, r.w, r.h];
  if (!vals.every(Number.isFinite)) return false;
  return r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 + 1e-6 && r.y + r.h <= 1 + 1e-6;
}

/** Keeps the page inside the stage: centred when smaller than the stage on an axis, edge-bound when larger. */
export function clampTransform(t: Transform, stage: Size, img: Size): Transform {
  const dw = img.w * t.s;
  const dh = img.h * t.s;
  const tx = dw <= stage.w ? (stage.w - dw) / 2 : clamp(t.tx, stage.w - dw, 0);
  const ty = dh <= stage.h ? (stage.h - dh) / 2 : clamp(t.ty, stage.h - dh, 0);
  return { tx, ty, s: t.s };
}

/** The 1x view: the padded region (or the whole page) fitted and centred in the stage. */
export function fitTransform(stage: Size, img: Size, region?: Rect | null, approximate = false): Transform {
  const view: Rect = isUsableRegion(region) ? paddedRegion(region, approximate) : { x: 0, y: 0, w: 1, h: 1 };
  const s = Math.min(stage.w / (view.w * img.w), stage.h / (view.h * img.h));
  const tx = stage.w / 2 - (view.x + view.w / 2) * img.w * s;
  const ty = stage.h / 2 - (view.y + view.h / 2) * img.h * s;
  return clampTransform({ tx, ty, s }, stage, img);
}

export const zoomLevel = (t: Transform, base: Transform) => t.s / base.s;
export const isZoomed = (t: Transform, base: Transform) => zoomLevel(t, base) > ZOOM_EPSILON;

/** Zooms to an absolute level (1 = fit .. MAX_ZOOM), keeping the stage point `at` fixed. */
export function zoomTo(t: Transform, base: Transform, stage: Size, img: Size, level: number, at: { x: number; y: number }): Transform {
  const s = clamp(level, 1, MAX_ZOOM) * base.s;
  if (s <= base.s * 1.0001) return base;
  const k = s / t.s;
  return clampTransform({ s, tx: at.x - (at.x - t.tx) * k, ty: at.y - (at.y - t.ty) * k }, stage, img);
}

/** Zooms by a factor (buttons x1.5, wheel, pinch), clamped to 1x..5x. */
export function zoomBy(t: Transform, base: Transform, stage: Size, img: Size, factor: number, at: { x: number; y: number }): Transform {
  return zoomTo(t, base, stage, img, zoomLevel(t, base) * factor, at);
}

export function panBy(t: Transform, stage: Size, img: Size, dx: number, dy: number): Transform {
  return clampTransform({ ...t, tx: t.tx + dx, ty: t.ty + dy }, stage, img);
}

/** Double tap: back to fit when zoomed, otherwise 2.5x at the tapped point. */
export function doubleTap(t: Transform, base: Transform, stage: Size, img: Size, at: { x: number; y: number }): Transform {
  return isZoomed(t, base) ? base : zoomTo(t, base, stage, img, DOUBLE_TAP_ZOOM, at);
}

/** A normalised region in stage pixels. */
export function regionToScreen(region: Rect, t: Transform, img: Size): Rect {
  return { x: t.tx + region.x * img.w * t.s, y: t.ty + region.y * img.h * t.s, w: region.w * img.w * t.s, h: region.h * img.h * t.s };
}

export const MIN_ARM = 12;
export const MAX_ARM = 28;
/** Corner arm length: 18% of the shorter side, clamped to 12-28 px (DS 7.10). */
export function armLength(r: Rect): number {
  const arm = clamp(0.18 * Math.min(r.w, r.h), MIN_ARM, MAX_ARM);
  // Never longer than half a side, so two arms never cross on a tiny region.
  return Math.min(arm, r.w / 2, r.h / 2);
}

/** SVG path of the four L-shaped corners of a rectangle. */
export function bracketPath(r: Rect): string {
  const a = armLength(r);
  const { x, y, w, h } = r;
  const x1 = x + w;
  const y1 = y + h;
  return [
    `M${x} ${y + a}V${y}H${x + a}`,
    `M${x1 - a} ${y}H${x1}V${y + a}`,
    `M${x1} ${y1 - a}V${y1}H${x1 - a}`,
    `M${x + a} ${y1}H${x}V${y1 - a}`,
  ].join('');
}

/** Callout disc centre: the region's top-left corner, kept inside the stage. */
export function calloutCenter(r: Rect, stage: Size, disc = 28): { x: number; y: number } {
  const half = disc / 2;
  return { x: clamp(r.x, half, Math.max(half, stage.w - half)), y: clamp(r.y, half, Math.max(half, stage.h - half)) };
}

/** Swipe: 64 px horizontal and within 30 degrees of horizontal, or a fling over 0.5 px/ms (USER_FLOWS 6.4). */
export function swipeDirection(dx: number, dy: number, dtMs: number): 'next' | 'prev' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0) return null;
  const withinAngle = ay <= ax * Math.tan((30 * Math.PI) / 180);
  if (!withinAngle) return null;
  const fling = dtMs > 0 && ax / dtMs > 0.5 && ax >= 24;
  if (ax >= 64 || fling) return dx < 0 ? 'next' : 'prev';
  return null;
}
