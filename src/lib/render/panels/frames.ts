import {
  CORNER_TOLERANCE_FRACTION, LINE_CLOSE_FRACTION, LINE_FRAGMENT_MIN_FRACTION, LINE_MERGE_GAP_FRACTION, LINE_MERGE_ACROSS_PX, LINE_MAX_THICKNESS_FRACTION, LINE_MIN_INK_FRACTION, LINE_MIN_LENGTH_FRACTION,
  MAX_LINE_CANDIDATES, MAX_LINE_OBJECTS, PANEL_MAX_AREA_FRACTION, PANEL_MIN_AREA_FRACTION, PANEL_MIN_SIDE_OF_SHORT, SIDE_COVERAGE_MIN,
} from './constants';
import type { Box } from './imageops';

/** A straight line: spans [a0, a1) along its direction and [b0, b1) across it. */
interface Line {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
  /** Centre across the line. */
  c: number;
  /** Prefix sums over a0..a1 of the columns (along the line) painted by any of its fragments. */
  cover: Int32Array;
}

interface LineSet {
  lines: Line[];
}

/** Rows above and below a line that a crossing stroke must span. */
const CROSS_PX = 4;

interface Obj {
  b0: number;
  b1: number;
  a0: number;
  a1: number;
  lastS: number;
  lastE: number;
  lastY: number;
  dead: boolean;
  runs: number[];
}

/**
 * Finds near-horizontal lines of `ink` (a w x h mask). Fragments are runs of ink along x, closed over short gaps
 * (dashes), at least `fragMin` long and LINE_MIN_INK_FRACTION inked, stacked over rows into objects at most `maxThick`
 * rows thick. Collinear fragments (a diagram crossing a frame breaks its line) are merged when the gap between them is
 * small; a merged line must reach `minLen`.
 */
function extractLines(ink: Uint8Array, w: number, h: number, closeLen: number, fragMin: number, minLen: number, maxThick: number, mergeGap: number): LineSet | undefined {
  const objs: Obj[] = [];
  let active: Obj[] = [];
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const next: Obj[] = [];
    let x = 0;
    while (x < w) {
      if (!ink[row + x]) { x++; continue; }
      const s = x;
      let last = x;
      let count = 1;
      x++;
      while (x < w) {
        if (ink[row + x]) { last = x; count++; x++; } else if (x - last > closeLen) break; else x++;
      }
      const len = last - s + 1;
      if (len < fragMin || count / len < LINE_MIN_INK_FRACTION) continue;
      let host: Obj | undefined;
      for (const o of active) {
        if (o.lastY !== y - 1 || next.includes(o)) continue;
        const overlap = Math.min(o.lastE, last) - Math.max(o.lastS, s) + 1;
        if (overlap >= 0.5 * Math.min(o.lastE - o.lastS + 1, len)) { host = o; break; }
      }
      if (!host) {
        host = { b0: y, b1: y, a0: s, a1: last, lastS: s, lastE: last, lastY: y, dead: false, runs: [] };
        objs.push(host);
        if (objs.length > MAX_LINE_OBJECTS) return undefined;
      }
      host.b1 = y;
      host.lastY = y;
      host.lastS = s;
      host.lastE = last;
      host.a0 = Math.min(host.a0, s);
      host.a1 = Math.max(host.a1, last);
      if (!host.dead) {
        if (y - host.b0 + 1 > maxThick) { host.dead = true; host.runs = []; } else host.runs.push(s, last);
      }
      next.push(host);
    }
    active = next;
  }
  // Merge collinear fragments into groups.
  const frags = objs.filter((o) => !o.dead).sort((p, q) => p.a0 - q.a0 || p.b0 - q.b0);
  const groups: { frags: Obj[]; a0: number; a1: number; c: number }[] = [];
  for (const o of frags) {
    const c = (o.b0 + o.b1 + 1) / 2;
    // Merge only over a gap that an object crosses (a diagram drawn over the frame): a vertical stroke runs through the
    // line's rows. Clear white space between two frames, where each side ends at its corner, stays a cut.
    const blocked = (gr: { a1: number }) => {
      for (let x = Math.max(0, gr.a1 - 2); x <= Math.min(w - 1, o.a0 + 2); x++) {
        let crossing = true;
        for (let y = Math.max(0, o.b0 - CROSS_PX); y <= Math.min(h - 1, o.b1 + CROSS_PX) && crossing; y++) crossing = ink[y * w + x] === 1;
        if (crossing) return true;
      }
      return false;
    };
    const g = groups.find((gr) => Math.abs(gr.c - c) <= LINE_MERGE_ACROSS_PX && o.a0 - gr.a1 <= mergeGap && blocked(gr));
    if (g) { g.frags.push(o); g.a1 = Math.max(g.a1, o.a1); } else groups.push({ frags: [o], a0: o.a0, a1: o.a1, c });
  }
  const lines: Line[] = [];
  for (const g of groups) {
    if (g.a1 - g.a0 + 1 < minLen) continue;
    const a0 = g.a0;
    const a1 = g.a1 + 1;
    const painted = new Uint8Array(a1 - a0);
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const o of g.frags) {
      b0 = Math.min(b0, o.b0);
      b1 = Math.max(b1, o.b1 + 1);
      for (let i = 0; i < o.runs.length; i += 2) painted.fill(1, o.runs[i]! - a0, o.runs[i + 1]! - a0 + 1);
    }
    const cover = new Int32Array(painted.length + 1);
    for (let i = 0; i < painted.length; i++) cover[i + 1] = cover[i]! + painted[i]!;
    lines.push({ a0, a1, b0, b1, c: (b0 + b1) / 2, cover });
  }
  lines.sort((p, q) => q.a1 - q.a0 - (p.a1 - p.a0) || p.c - q.c || p.a0 - q.a0);
  lines.length = Math.min(lines.length, MAX_LINE_CANDIDATES);
  lines.sort((p, q) => p.c - q.c || p.a0 - q.a0);
  return { lines };
}

/** Share of [a0, a1) painted by the line's fragments. */
function coverage(line: Line, a0: number, a1: number): number {
  const lo = Math.max(line.a0, Math.round(a0));
  const hi = Math.min(line.a1, Math.round(a1));
  if (a1 <= a0 || hi <= lo) return 0;
  return (line.cover[hi - line.a0]! - line.cover[lo - line.a0]!) / Math.round(a1 - a0);
}

const transpose = (ink: Uint8Array, w: number, h: number): Uint8Array => {
  const t = new Uint8Array(ink.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[x * h + y] = ink[y * w + x]!;
  return t;
};

/**
 * Pass A: rectangles drawn with lines. Pairs horizontal lines with vertical lines whose ends meet at the corners and
 * keeps rectangles whose four sides are at least SIDE_COVERAGE_MIN covered, passing the size filter and not inside a
 * larger kept rectangle. Returns pixel boxes, or undefined when the line search was abandoned (too many candidates).
 */
export function findFrames(ink: Uint8Array, w: number, h: number, box: Box): Box[] | undefined {
  const closeH = Math.max(1, Math.round(LINE_CLOSE_FRACTION * w));
  const closeV = Math.max(1, Math.round(LINE_CLOSE_FRACTION * h));
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const hs = extractLines(ink, w, h, closeH, Math.ceil(LINE_FRAGMENT_MIN_FRACTION * bw), Math.ceil(LINE_MIN_LENGTH_FRACTION * bw), Math.max(1, Math.floor(LINE_MAX_THICKNESS_FRACTION * h)), Math.ceil(LINE_MERGE_GAP_FRACTION * bw));
  const vs = extractLines(transpose(ink, w, h), h, w, closeV, Math.ceil(LINE_FRAGMENT_MIN_FRACTION * bh), Math.ceil(LINE_MIN_LENGTH_FRACTION * bh), Math.max(1, Math.floor(LINE_MAX_THICKNESS_FRACTION * w)), Math.ceil(LINE_MERGE_GAP_FRACTION * bh));
  if (!hs || !vs) return undefined;
  const tol = Math.max(2, Math.round(CORNER_TOLERANCE_FRACTION * Math.min(w, h)));
  const minSide = PANEL_MIN_SIDE_OF_SHORT * Math.min(w, h);
  const pageArea = w * h;
  const meets = (hl: Line, vl: Line) => vl.c >= hl.a0 - tol && vl.c <= hl.a1 + tol && hl.c >= vl.a0 - tol && hl.c <= vl.a1 + tol;
  // For every horizontal line, the vertical lines meeting it.
  const touching = hs.lines.map((hl) => vs.lines.map((vl, i) => (meets(hl, vl) ? i : -1)).filter((i) => i >= 0));
  const found: Box[] = [];
  for (let ti = 0; ti < hs.lines.length; ti++) {
    for (let bi = ti + 1; bi < hs.lines.length; bi++) {
      const t = hs.lines[ti]!;
      const b = hs.lines[bi]!;
      if (b.c - t.c < minSide) continue;
      const both = touching[ti]!.filter((i) => touching[bi]!.includes(i));
      for (let li = 0; li < both.length; li++) {
        for (let ri = li + 1; ri < both.length; ri++) {
          const l = vs.lines[both[li]!]!;
          const r = vs.lines[both[ri]!]!;
          const rw = r.c - l.c;
          const rh = b.c - t.c;
          if (rw < minSide) continue;
          const share = (rw * rh) / pageArea;
          if (share < PANEL_MIN_AREA_FRACTION || share > PANEL_MAX_AREA_FRACTION) continue;
          if (coverage(t, l.c, r.c) < SIDE_COVERAGE_MIN || coverage(b, l.c, r.c) < SIDE_COVERAGE_MIN) continue;
          if (coverage(l, t.c, b.c) < SIDE_COVERAGE_MIN || coverage(r, t.c, b.c) < SIDE_COVERAGE_MIN) continue;
          found.push({ x0: Math.round(l.c), y0: Math.round(t.c), x1: Math.round(r.c), y1: Math.round(b.c) });
        }
      }
    }
  }
  const area = (r: Box) => (r.x1 - r.x0) * (r.y1 - r.y0);
  found.sort((p, q) => area(q) - area(p) || p.y0 - q.y0 || p.x0 - q.x0);
  const kept: Box[] = [];
  for (const r of found) {
    const inside = kept.some((k) => r.x0 >= k.x0 - tol && r.y0 >= k.y0 - tol && r.x1 <= k.x1 + tol && r.y1 <= k.y1 + tol);
    if (!inside) kept.push(r);
  }
  return kept;
}
