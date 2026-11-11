import { describe, expect, it } from 'vitest';
import {
  armLength,
  bracketPath,
  calloutCenter,
  clampTransform,
  doubleTap,
  fitTransform,
  isZoomed,
  MAX_ZOOM,
  paddedRegion,
  panBy,
  regionToScreen,
  swipeDirection,
  zoomBy,
  zoomLevel,
  zoomTo,
} from '@/components/features/source-visual/geometry';

const stage = { w: 400, h: 300 };
const img = { w: 1000, h: 1400 };

describe('paddedRegion', () => {
  it('pads by 6% of the page on each side and clamps to the page', () => {
    const r = paddedRegion({ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, false);
    expect(r.x).toBeCloseTo(0.24);
    expect(r.y).toBeCloseTo(0.24);
    expect(r.w).toBeCloseTo(0.32);
    expect(r.h).toBeCloseTo(0.32);
    const edge = paddedRegion({ x: 0, y: 0.9, w: 0.1, h: 0.1 }, false);
    expect(edge.x).toBe(0);
    expect(edge.y + edge.h).toBeCloseTo(1);
  });
  it('uses 12% for an approximate region', () => {
    const r = paddedRegion({ x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, true);
    expect(r.x).toBeCloseTo(0.28);
    expect(r.w).toBeCloseTo(0.34);
  });
});

describe('fitTransform', () => {
  it('shows the whole page, centred, when there is no region', () => {
    const t = fitTransform(stage, img);
    expect(t.s).toBeCloseTo(Math.min(400 / 1000, 300 / 1400));
    const page = { w: img.w * t.s, h: img.h * t.s };
    expect(t.tx).toBeCloseTo((stage.w - page.w) / 2);
    expect(t.ty).toBeCloseTo(0);
  });
  it('keeps the padded region fully inside the stage', () => {
    const region = { x: 0.2, y: 0.4, w: 0.3, h: 0.2 };
    const t = fitTransform(stage, img, region);
    const r = regionToScreen(paddedRegion(region, false), t, img);
    expect(r.x).toBeGreaterThanOrEqual(-0.5);
    expect(r.y).toBeGreaterThanOrEqual(-0.5);
    expect(r.x + r.w).toBeLessThanOrEqual(stage.w + 0.5);
    expect(r.y + r.h).toBeLessThanOrEqual(stage.h + 0.5);
  });
  it('treats an invalid region as the whole page', () => {
    expect(fitTransform(stage, img, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 })).toEqual(fitTransform(stage, img));
    expect(fitTransform(stage, img, { x: 0, y: 0, w: 0, h: 0.5 })).toEqual(fitTransform(stage, img));
  });
  it('never leaves empty space inside the stage when the page is larger than the stage', () => {
    const t = fitTransform(stage, img, { x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
    expect(t.tx).toBeLessThanOrEqual(0);
    expect(t.tx + img.w * t.s).toBeGreaterThanOrEqual(stage.w - 0.5);
    expect(t.ty + img.h * t.s).toBeGreaterThanOrEqual(stage.h - 0.5);
  });
});

describe('zoom', () => {
  const base = fitTransform(stage, img, { x: 0.2, y: 0.4, w: 0.3, h: 0.2 });
  it('clamps between 1x and 5x', () => {
    const out = zoomBy(base, base, stage, img, 0.2, { x: 200, y: 150 });
    expect(out).toEqual(base);
    let t = base;
    for (let i = 0; i < 20; i++) t = zoomBy(t, base, stage, img, 1.5, { x: 200, y: 150 });
    expect(zoomLevel(t, base)).toBeCloseTo(MAX_ZOOM);
  });
  it('keeps the point under the finger fixed', () => {
    const at = { x: 120, y: 90 };
    const norm = { u: (at.x - base.tx) / (img.w * base.s), v: (at.y - base.ty) / (img.h * base.s) };
    const t = zoomTo(base, base, stage, img, 2.5, at);
    expect(t.tx + norm.u * img.w * t.s).toBeCloseTo(at.x, 3);
    expect(t.ty + norm.v * img.h * t.s).toBeCloseTo(at.y, 3);
    expect(isZoomed(t, base)).toBe(true);
  });
  it('double tap toggles fit and 2.5x', () => {
    const z = doubleTap(base, base, stage, img, { x: 100, y: 100 });
    expect(zoomLevel(z, base)).toBeCloseTo(2.5);
    expect(doubleTap(z, base, stage, img, { x: 100, y: 100 })).toEqual(base);
  });
  it('pan is bounded to the page', () => {
    const z = zoomTo(base, base, stage, img, 4, { x: 200, y: 150 });
    const far = panBy(z, stage, img, 1e6, 1e6);
    expect(far.tx).toBeLessThanOrEqual(0);
    expect(far.ty).toBeLessThanOrEqual(0);
    const other = panBy(z, stage, img, -1e6, -1e6);
    expect(other.tx + img.w * other.s).toBeCloseTo(stage.w);
    expect(other.ty + img.h * other.s).toBeCloseTo(stage.h);
  });
});

describe('clampTransform', () => {
  it('centres a page smaller than the stage', () => {
    const t = clampTransform({ tx: 500, ty: -500, s: 0.1 }, stage, img);
    expect(t.tx).toBeCloseTo((400 - 100) / 2);
    expect(t.ty).toBeCloseTo((300 - 140) / 2);
  });
});

describe('brackets and callouts', () => {
  it('arm length is 18% of the shorter side, clamped to 12-28 px', () => {
    expect(armLength({ x: 0, y: 0, w: 100, h: 100 })).toBeCloseTo(18);
    expect(armLength({ x: 0, y: 0, w: 40, h: 300 })).toBe(12);
    expect(armLength({ x: 0, y: 0, w: 900, h: 700 })).toBe(28);
    expect(armLength({ x: 0, y: 0, w: 16, h: 16 })).toBe(8);
  });
  it('draws four corners', () => {
    expect(bracketPath({ x: 10, y: 10, w: 100, h: 80 }).match(/M/g)).toHaveLength(4);
  });
  it('keeps the callout disc inside the stage', () => {
    expect(calloutCenter({ x: -30, y: -10, w: 10, h: 10 }, stage)).toEqual({ x: 14, y: 14 });
    expect(calloutCenter({ x: 999, y: 999, w: 10, h: 10 }, stage)).toEqual({ x: 386, y: 286 });
  });
});

describe('swipeDirection', () => {
  it('needs 64 px of mostly horizontal travel', () => {
    expect(swipeDirection(-70, 5, 400)).toBe('next');
    expect(swipeDirection(70, -5, 400)).toBe('prev');
    expect(swipeDirection(-50, 0, 400)).toBeNull();
    expect(swipeDirection(-80, 60, 400)).toBeNull(); // about 37 degrees
    expect(swipeDirection(-80, 40, 400)).toBe('next'); // 26.6 degrees is inside 30
  });
  it('accepts a fling over 0.5 px/ms below the distance threshold', () => {
    expect(swipeDirection(-40, 0, 40)).toBe('next');
    expect(swipeDirection(-40, 0, 400)).toBeNull();
    expect(swipeDirection(0, 100, 100)).toBeNull();
  });
});
