import {
  BLANK_INK_FRACTION, CAPTION_COLUMN_OVERLAP, CAPTION_MAX_HEIGHT_FRACTION, CAPTION_MERGE_DISTANCE_FRACTION, GAP_MIN_FRACTION,
  HEADER_FOOTER_FRACTION, TEXT_LINE_MAX_HEIGHT_FRACTION, TEXT_MAX_INK_DENSITY, XY_MAX_DEPTH,
} from './constants';
import type { Box } from './imageops';

interface Profiles {
  rows: Int32Array;
  cols: Int32Array;
  ink: number;
}

function profiles(ink: Uint8Array, w: number, b: Box): Profiles {
  const rows = new Int32Array(b.y1 - b.y0);
  const cols = new Int32Array(b.x1 - b.x0);
  let total = 0;
  for (let y = b.y0; y < b.y1; y++) {
    const base = y * w;
    for (let x = b.x0; x < b.x1; x++) {
      if (ink[base + x]) { rows[y - b.y0]!++; cols[x - b.x0]!++; total++; }
    }
  }
  return { rows, cols, ink: total };
}

/** First and last non-blank index of a profile (`tol` ink pixels or fewer count as blank), or undefined. */
function extent(p: Int32Array, tol: number): [number, number] | undefined {
  let a = 0;
  while (a < p.length && p[a]! <= tol) a++;
  if (a === p.length) return undefined;
  let z = p.length - 1;
  while (p[z]! <= tol) z--;
  return [a, z];
}

/** Widest run of blank entries strictly inside [a, z]: its length and centre index. */
function widestGap(p: Int32Array, tol: number, a: number, z: number): { len: number; at: number } {
  let best = { len: 0, at: 0 };
  let i = a;
  while (i <= z) {
    if (p[i]! > tol) { i++; continue; }
    let j = i;
    while (j <= z && p[j]! <= tol) j++;
    if (j - i > best.len) best = { len: j - i, at: i + Math.floor((j - i) / 2) };
    i = j;
  }
  return best;
}

const tolFor = (n: number) => Math.floor(BLANK_INK_FRACTION * n);

export interface Block {
  box: Box;
  text: boolean;
}

/** Text means sparse ink in short, separate lines (a caption, a label, a paragraph). */
function isTextBlock(ink: Uint8Array, w: number, h: number, b: Box): boolean {
  const p = profiles(ink, w, b);
  const area = (b.x1 - b.x0) * (b.y1 - b.y0);
  if (area === 0 || p.ink / area >= TEXT_MAX_INK_DENSITY) return false;
  const tol = tolFor(b.x1 - b.x0);
  const maxLine = TEXT_LINE_MAX_HEIGHT_FRACTION * h;
  let i = 0;
  let runs = 0;
  while (i < p.rows.length) {
    if (p.rows[i]! <= tol) { i++; continue; }
    let j = i;
    while (j < p.rows.length && p.rows[j]! > tol) j++;
    if (j - i > maxLine) return false;
    runs++;
    i = j;
  }
  return runs > 0;
}

/** Pass B: recursive XY-cut of the content box at the widest blank gaps. Returns the leaf blocks. */
export function xyCut(ink: Uint8Array, w: number, h: number, box: Box, gapFactor: number): Block[] {
  const leaves: Block[] = [];
  const minGapY = GAP_MIN_FRACTION * gapFactor * h;
  const minGapX = GAP_MIN_FRACTION * gapFactor * w;

  const visit = (start: Box, depth: number) => {
    let b = start;
    const first = profiles(ink, w, b);
    const er = extent(first.rows, tolFor(b.x1 - b.x0));
    const ec = extent(first.cols, tolFor(b.y1 - b.y0));
    if (!er || !ec) return;
    b = { x0: b.x0 + ec[0], x1: b.x0 + ec[1] + 1, y0: b.y0 + er[0], y1: b.y0 + er[1] + 1 };
    if (depth < XY_MAX_DEPTH) {
      const p = profiles(ink, w, b);
      const gy = widestGap(p.rows, tolFor(b.x1 - b.x0), 0, p.rows.length - 1);
      const gx = widestGap(p.cols, tolFor(b.y1 - b.y0), 0, p.cols.length - 1);
      const canY = gy.len >= minGapY;
      const canX = gx.len >= minGapX;
      if (canY || canX) {
        if (canY && (!canX || gy.len / h >= gx.len / w)) {
          visit({ ...b, y1: b.y0 + gy.at }, depth + 1);
          visit({ ...b, y0: b.y0 + gy.at }, depth + 1);
        } else {
          visit({ ...b, x1: b.x0 + gx.at }, depth + 1);
          visit({ ...b, x0: b.x0 + gx.at }, depth + 1);
        }
        return;
      }
    }
    leaves.push({ box: b, text: isTextBlock(ink, w, h, b) });
  };
  visit(box, 0);
  return leaves;
}

/**
 * Turns leaves into picture blocks: drops running headers and footers, then merges each caption (short text block)
 * into the nearest picture directly above or below it in the same column. Other text blocks are not offered.
 */
export function pictureBlocks(leaves: Block[], w: number, h: number): Box[] {
  const pictures = leaves.filter((l) => !l.text).map((l) => ({ ...l.box }));
  const edge = HEADER_FOOTER_FRACTION * h;
  const captions = leaves
    .filter((l) => l.text && l.box.y1 > edge && l.box.y0 < h - edge && l.box.y1 - l.box.y0 < CAPTION_MAX_HEIGHT_FRACTION * h)
    .map((l) => l.box)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const reach = CAPTION_MERGE_DISTANCE_FRACTION * h;
  for (const c of captions) {
    let best: { box: Box; dist: number } | undefined;
    for (const p of pictures) {
      const overlap = Math.min(p.x1, c.x1) - Math.max(p.x0, c.x0);
      if (overlap < CAPTION_COLUMN_OVERLAP * (c.x1 - c.x0)) continue;
      const dist = c.y0 >= p.y1 ? c.y0 - p.y1 : p.y0 >= c.y1 ? p.y0 - c.y1 : -1;
      if (dist < 0 || dist > reach) continue;
      if (!best || dist < best.dist) best = { box: p, dist };
    }
    if (best) {
      best.box.x0 = Math.min(best.box.x0, c.x0);
      best.box.x1 = Math.max(best.box.x1, c.x1);
      best.box.y0 = Math.min(best.box.y0, c.y0);
      best.box.y1 = Math.max(best.box.y1, c.y1);
    }
  }
  void w;
  return pictures;
}
