import {
  LINE_BACKGROUND_MARGIN, OTSU_MAX, OTSU_MIN, SKEW_LIMIT_DEG, SKEW_MIN_GAIN, SKEW_SEARCH_DEG, SKEW_STEP_DEG, SPECK_AREA_FRACTION,
} from './constants';

/** Pixel rectangle; x1 and y1 are exclusive. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Grey {
  w: number;
  h: number;
  data: Uint8Array;
}

/**
 * Shrinks to a long edge of `target` pixels. `darkest` takes the darkest source pixel of each target pixel's footprint:
 * averaging washes 1-2 px rules out to light grey (below the ink threshold), the darkest pixel keeps them. `mean`
 * averages (box filter) and is what noisy scans need.
 */
export function shrink(src: Grey, target: number, mode: 'darkest' | 'mean'): Grey {
  const scale = Math.max(src.w, src.h) / target;
  if (scale <= 1) return src;
  const w = Math.max(1, Math.round(src.w / scale));
  const h = Math.max(1, Math.round(src.h / scale));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * src.h) / h);
    const sy1 = Math.max(sy0 + 1, Math.ceil(((y + 1) * src.h) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * src.w) / w);
      const sx1 = Math.max(sx0 + 1, Math.ceil(((x + 1) * src.w) / w));
      let m = 255;
      let sum = 0;
      for (let yy = sy0; yy < sy1; yy++) {
        const row = yy * src.w;
        for (let xx = sx0; xx < sx1; xx++) {
          const v = src.data[row + xx]!;
          if (v < m) m = v;
          sum += v;
        }
      }
      out[y * w + x] = mode === 'darkest' ? m : Math.round(sum / ((sy1 - sy0) * (sx1 - sx0)));
    }
  }
  return { w, h, data: out };
}

/** Share of ink pixels that have no ink neighbour (8-neighbourhood): salt-and-pepper noise shows up here, clean renders do not. */
export function isolatedInkShare(ink: Uint8Array, w: number, h: number): number {
  let total = 0;
  let lone = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      total++;
      let alone = true;
      for (let dy = -1; dy <= 1 && alone; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((dx || dy) && nx >= 0 && nx < w && ink[ny * w + nx]) { alone = false; break; }
        }
      }
      if (alone) lone++;
    }
  }
  return total === 0 ? 0 : lone / total;
}

export function meanLuminance(g: Grey): number {
  let sum = 0;
  for (let i = 0; i < g.data.length; i++) sum += g.data[i]!;
  return g.data.length === 0 ? 1 : sum / g.data.length / 255;
}

export function invert(g: Grey): Grey {
  const out = new Uint8Array(g.data.length);
  for (let i = 0; i < out.length; i++) out[i] = 255 - g.data[i]!;
  return { w: g.w, h: g.h, data: out };
}

/** 3x3 median (edges replicated). Removes salt-and-pepper scan noise. */
export function median3(g: Grey): Grey {
  const { w, h, data } = g;
  const out = new Uint8Array(data.length);
  const win = new Uint8Array(9);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1) * w;
    const y0 = y * w;
    const yp = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(w - 1, x + 1);
      win[0] = data[ym + xm]!; win[1] = data[ym + x]!; win[2] = data[ym + xp]!;
      win[3] = data[y0 + xm]!; win[4] = data[y0 + x]!; win[5] = data[y0 + xp]!;
      win[6] = data[yp + xm]!; win[7] = data[yp + x]!; win[8] = data[yp + xp]!;
      // Insertion sort of nine values is faster than a generic sort here.
      for (let i = 1; i < 9; i++) {
        const v = win[i]!;
        let j = i - 1;
        while (j >= 0 && win[j]! > v) { win[j + 1] = win[j]!; j--; }
        win[j + 1] = v;
      }
      out[y0 + x] = win[4]!;
    }
  }
  return { w, h, data: out };
}

/** Otsu's threshold, clamped to [OTSU_MIN, OTSU_MAX]. */
export function inkThreshold(g: Grey): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]!]!++;
  const total = g.data.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]!;
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let threshold = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }
  return Math.min(OTSU_MAX, Math.max(OTSU_MIN, threshold));
}

/**
 * Threshold for rule lines: more permissive than the ink threshold so light grey panel borders (often #aaa-#ccc, thin
 * and blurred by the downscale) count. It sits `LINE_BACKGROUND_MARGIN` below the page background (90th percentile grey).
 */
export function lineThreshold(g: Grey, ink: number): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]!]!++;
  let acc = 0;
  let bg = 255;
  for (let t = 0; t < 256; t++) { acc += hist[t]!; if (acc >= 0.9 * g.data.length) { bg = t; break; } }
  return Math.max(ink, Math.min(OTSU_MAX, bg - LINE_BACKGROUND_MARGIN));
}

/** 1 where a pixel is darker than the threshold. */
export function binarise(g: Grey, threshold: number): Uint8Array {
  const ink = new Uint8Array(g.data.length);
  for (let i = 0; i < ink.length; i++) ink[i] = g.data[i]! < threshold ? 1 : 0;
  return ink;
}

/**
 * Bounding box of the ink, ignoring connected components (8-neighbourhood) whose bounding box is smaller than
 * SPECK_AREA_FRACTION of the page. Returns undefined for a page without content.
 */
export function contentBox(ink: Uint8Array, w: number, h: number): Box | undefined {
  const minArea = SPECK_AREA_FRACTION * w * h;
  const seen = new Uint8Array(ink.length);
  const stack = new Int32Array(ink.length);
  let box: Box | undefined;
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (sp > 0) {
      const p = stack[--sp]!;
      const y = (p / w) | 0;
      const x = p - y * w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (ink[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
        }
      }
    }
    if ((x1 - x0 + 1) * (y1 - y0 + 1) < minArea) continue;
    box = box ? { x0: Math.min(box.x0, x0), y0: Math.min(box.y0, y0), x1: Math.max(box.x1, x1 + 1), y1: Math.max(box.y1, y1 + 1) } : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }
  return box;
}

/** Bounding box of all ink, specks included (text letters are specks, but captions and labels must stay visible to the cut). */
export function inkBounds(ink: Uint8Array, w: number, h: number): Box | undefined {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? undefined : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Projection-profile skew check: true when shearing the ink by an angle beyond SKEW_LIMIT_DEG makes its row profile
 * clearly sharper than it is unsheared (text lines and rules line up when the shear cancels the skew).
 */
export function isSkewed(ink: Uint8Array, w: number, h: number): boolean {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (ink[y * w + x]) { xs.push(x); ys.push(y); }
  if (xs.length < 50) return false;
  const pad = Math.ceil(w * Math.tan((SKEW_SEARCH_DEG * Math.PI) / 180)) + 2;
  const bins = new Float64Array(h + 2 * pad);
  const score = (deg: number): number => {
    bins.fill(0);
    const t = Math.tan((deg * Math.PI) / 180);
    for (let i = 0; i < xs.length; i++) bins[Math.round(ys[i]! + xs[i]! * t) + pad]!++;
    let s = 0;
    for (let i = 0; i < bins.length; i++) s += bins[i]! * bins[i]!;
    return s;
  };
  const base = score(0);
  let best = 0;
  let bestScore = base;
  for (let d = -SKEW_SEARCH_DEG; d <= SKEW_SEARCH_DEG + 1e-9; d += SKEW_STEP_DEG) {
    const s = score(d);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  return Math.abs(best) > SKEW_LIMIT_DEG && bestScore >= base * SKEW_MIN_GAIN;
}
