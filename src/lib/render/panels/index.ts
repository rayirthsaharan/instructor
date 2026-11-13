import sharp from 'sharp';
import type { DetectedPanel } from '../../ai/provider';
import type { Region } from '../../guide/schema';
import { MAX_INPUT_PIXELS, PAGE_IMAGE_MAX_DIM } from '../../limits';
import {
  DARK_PAGE_MEAN_LUMINANCE, FRAMES_MAX_OVERLAP, NOISY_ISOLATED_INK_SHARE, FRAMES_MIN_COUNT, FRAMES_MIN_COVERAGE, GAP_RETRIES, GAP_RETRY_FACTOR, MAX_PANELS, PANEL_MAX_AREA_FRACTION,
  PANEL_MIN_AREA_FRACTION, PANEL_MIN_SIDE_OF_SHORT, PANEL_PAD, ROW_TOLERANCE, WORK_LONG_EDGE,
} from './constants';
import { findFrames } from './frames';
import { binarise, contentBox, inkBounds, inkThreshold, invert, lineThreshold, isSkewed, isolatedInkShare, meanLuminance, median3, shrink, type Box, type Grey } from './imageops';
import { pictureBlocks, xyCut } from './xycut';

export type PanelMethod = 'frames' | 'xycut' | 'none';

export interface PageDetection {
  pageIndex: number;
  method: PanelMethod;
  /** In reading order; empty for method `none`. */
  panels: (DetectedPanel & { areaShare: number })[];
}

/** What is stored per page and sent to the provider (`areaShare` is dropped). */
export interface StoredPagePanels {
  method: PanelMethod;
  panels: DetectedPanel[];
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Step 5: keeps boxes that are big enough and neither tiny nor the whole page. */
function sizeFilter(boxes: Box[], w: number, h: number): Box[] {
  const minSide = PANEL_MIN_SIDE_OF_SHORT * Math.min(w, h);
  return boxes.filter((b) => {
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const share = (bw * bh) / (w * h);
    return bw >= minSide && bh >= minSide && share >= PANEL_MIN_AREA_FRACTION && share <= PANEL_MAX_AREA_FRACTION;
  });
}

/** True when two boxes share more than FRAMES_MAX_OVERLAP of the smaller one. */
function overlapping(boxes: Box[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const inter = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
      const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
      if (inter > FRAMES_MAX_OVERLAP * smaller) return true;
    }
  }
  return false;
}

/** Step 6: pad, clamp, round, order (rows whose tops are within 2% are one row, then left to right) and name. */
function finish(boxes: Box[], w: number, h: number, pageIndex: number): PageDetection['panels'] {
  const regions = boxes.map((b) => {
    const x0 = Math.max(0, b.x0 / w - PANEL_PAD);
    const y0 = Math.max(0, b.y0 / h - PANEL_PAD);
    const x1 = Math.min(1, b.x1 / w + PANEL_PAD);
    const y1 = Math.min(1, b.y1 / h + PANEL_PAD);
    const region: Region = { x: round4(x0), y: round4(y0), w: round4(Math.min(1, x1) - round4(x0)), h: round4(Math.min(1, y1) - round4(y0)) };
    return region;
  });
  const sorted = [...regions].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Region[][] = [];
  for (const r of sorted) {
    const row = rows.find((rw) => Math.abs(rw[0]!.y - r.y) <= ROW_TOLERANCE);
    if (row) row.push(r);
    else rows.push([r]);
  }
  return rows
    .flatMap((row) => row.sort((a, b) => a.x - b.x))
    .map((region, i) => ({ panelId: `p${pageIndex + 1}-${String.fromCharCode(97 + i)}`, region, areaShare: round4(region.w * region.h) }));
}

const NONE = (pageIndex: number): PageDetection => ({ pageIndex, method: 'none', panels: [] });

/**
 * Step 1 for a full-size greyscale page: scale to the working size keeping thin rules (darkest pixel). If the result is
 * a noisy scan, redo it as the spec says: average downscale, then a 3x3 median.
 */
export function workingImage(full: Grey): Grey {
  const dark = shrink(full, WORK_LONG_EDGE, 'darkest');
  const ink = binarise(dark, inkThreshold(dark));
  if (isolatedInkShare(ink, dark.w, dark.h) <= NOISY_ISOLATED_INK_SHARE) return dark;
  return median3(shrink(full, WORK_LONG_EDGE, 'mean'));
}

/** Pure detector over a working-size greyscale page (see `workingImage`). Deterministic. */
export function detectPanelsInGrey(input: Grey, pageIndex: number): PageDetection {
  let grey = input;
  if (meanLuminance(grey) < DARK_PAGE_MEAN_LUMINANCE) grey = invert(grey);
  const { w, h } = grey;
  const threshold = inkThreshold(grey);
  const ink = binarise(grey, threshold);
  const box = contentBox(ink, w, h);
  if (!box) return NONE(pageIndex);
  if (isSkewed(ink, w, h)) return NONE(pageIndex);

  // Pass A: framed panels. Rules are looked for in the ink first, then (light grey borders) in a more permissive mask.
  const boxArea = (box.x1 - box.x0) * (box.y1 - box.y0);
  for (const mask of [ink, binarise(grey, lineThreshold(grey, threshold))]) {
    const frames = findFrames(mask, w, h, box);
    if (!frames) continue;
    const kept = sizeFilter(frames, w, h);
    const covered = kept.reduce((s, b) => s + (b.x1 - b.x0) * (b.y1 - b.y0), 0);
    if (kept.length >= FRAMES_MIN_COUNT && kept.length <= MAX_PANELS && !overlapping(kept) && covered >= FRAMES_MIN_COVERAGE * boxArea) {
      return { pageIndex, method: 'frames', panels: finish(kept, w, h, pageIndex) };
    }
  }

  // Pass B: whitespace cut over all the ink (text included, so captions are seen). Too many panels -> coarser gaps, then give up.
  const root = inkBounds(ink, w, h) ?? box;
  let factor = 1;
  for (let attempt = 0; attempt <= GAP_RETRIES; attempt++, factor *= GAP_RETRY_FACTOR) {
    const picks = sizeFilter(pictureBlocks(xyCut(ink, w, h, root, factor), w, h), w, h);
    if (picks.length > MAX_PANELS) continue;
    // A single panel is "this page is one diagram": nothing is offered and the whole page is the source.
    if (picks.length < 2) return NONE(pageIndex);
    return { pageIndex, method: 'xycut', panels: finish(picks, w, h, pageIndex) };
  }
  return NONE(pageIndex);
}

/** Decodes a stored page image (PNG or WebP), scales it to the working size and detects its panels. */
export async function detectPanels(image: Uint8Array, pageIndex: number): Promise<PageDetection> {
  const { data, info } = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
    .flatten({ background: '#ffffff' })
    .resize({ width: PAGE_IMAGE_MAX_DIM, height: PAGE_IMAGE_MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const full = { w: info.width, h: info.height, data: new Uint8Array(data.buffer, data.byteOffset, info.width * info.height) };
  return detectPanelsInGrey(workingImage(full), pageIndex);
}

export const toStored = (d: PageDetection): StoredPagePanels => ({ method: d.method, panels: d.panels.map(({ panelId, region }) => ({ panelId, region })) });
