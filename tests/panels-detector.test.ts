import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { detectPanels, type PageDetection } from '@/lib/render/panels';
import { MAX_PANELS } from '@/lib/render/panels/constants';
import fixtureGuide from '../fixtures/lumen-bookcase.guide.json';

// Synthetic pages are drawn as SVG (shapes only, no fonts) and rasterised by sharp.
type Rect = { x: number; y: number; w: number; h: number };
const W = 1100;
const H = 1500;

const svgPage = (body: string, bg = '#fff', w = W, h = H) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;
const png = (svg: string) => sharp(Buffer.from(svg)).png().toBuffer();

const frame = (r: Rect, stroke = '#333', width = 3, extra = '') => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
/** A small "drawing" inside a rectangle: a filled shape and a few strokes. */
const drawing = (r: Rect, ink = '#222') =>
  `<rect x="${r.x + r.w * 0.2}" y="${r.y + r.h * 0.3}" width="${r.w * 0.5}" height="${r.h * 0.3}" fill="${ink}"/>` +
  `<circle cx="${r.x + r.w * 0.75}" cy="${r.y + r.h * 0.25}" r="${Math.min(r.w, r.h) * 0.1}" fill="none" stroke="${ink}" stroke-width="4"/>` +
  `<line x1="${r.x + r.w * 0.1}" y1="${r.y + r.h * 0.8}" x2="${r.x + r.w * 0.9}" y2="${r.y + r.h * 0.7}" stroke="${ink}" stroke-width="4"/>`;
/** Rows of short text-like bars. */
const textLines = (x: number, y: number, w: number, n: number, ink = '#333') =>
  Array.from({ length: n }, (_, i) => `<line x1="${x}" y1="${y + i * 22 + 5}" x2="${x + w * (i % 3 === 2 ? 0.6 : 1)}" y2="${y + i * 22 + 5}" stroke="${ink}" stroke-width="10" stroke-dasharray="6 4"/>`).join('');

const area = (r: Rect) => r.w * r.h;
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const iou = (a: Rect, b: Rect) => overlap(a, b) / (area(a) + area(b) - overlap(a, b));
const norm = (r: Rect): Rect => ({ x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H });
/** Every expected rectangle is matched by exactly one detected panel at IoU >= 0.8. */
function expectPanels(d: PageDetection, expected: Rect[]) {
  expect(d.panels).toHaveLength(expected.length);
  for (const e of expected.map(norm)) expect(d.panels.some((p) => iou(p.region, e) >= 0.8), JSON.stringify(e)).toBe(true);
}
const regionsOf = (d: PageDetection) => d.panels.map((p) => p.region);

const GRID: Rect[] = [
  { x: 80, y: 100, w: 450, h: 600 }, { x: 570, y: 100, w: 450, h: 600 },
  { x: 80, y: 760, w: 450, h: 600 }, { x: 570, y: 760, w: 450, h: 600 },
];
const gridPage = (stroke = '#333', width = 3, bg = '#fff', ink = '#222', extra = '') =>
  svgPage(GRID.map((r) => frame(r, stroke, width, extra) + drawing(r, ink)).join(''), bg);

describe('panel detector: synthetic pages', () => {
  it('finds a 2x2 grid of bordered boxes in reading order with stable ids', async () => {
    const d = await detectPanels(await png(gridPage()), 4);
    expect(d.method).toBe('frames');
    expectPanels(d, GRID);
    expect(d.panels.map((p) => p.panelId)).toEqual(['p5-a', 'p5-b', 'p5-c', 'p5-d']);
    expect(regionsOf(d)[1]!.x).toBeGreaterThan(regionsOf(d)[0]!.x);
    expect(regionsOf(d)[2]!.y).toBeGreaterThan(regionsOf(d)[0]!.y);
    for (const p of d.panels) expect(p.areaShare).toBeCloseTo(p.region.w * p.region.h, 3);
  });

  it('finds dashed and light grey borders', async () => {
    expectPanels(await detectPanels(await png(gridPage('#333', 3, '#fff', '#222', 'stroke-dasharray="14 8"')), 0), GRID);
    expectPanels(await detectPanels(await png(gridPage('#b0b0b0', 3)), 0), GRID);
  });

  it('keeps a bordered box with an inset inside it as one panel (nested insets belong to their parent)', async () => {
    const outer: Rect[] = [{ x: 80, y: 100, w: 450, h: 700 }, { x: 570, y: 100, w: 450, h: 700 }];
    const inset: Rect = { x: 120, y: 160, w: 200, h: 200 };
    const body = outer.map((r) => frame(r) + drawing(r)).join('') + frame(inset) + frame({ x: 610, y: 160, w: 200, h: 200 });
    expectPanels(await detectPanels(await png(svgPage(body)), 1), outer);
  });

  it('cuts borderless blocks at whitespace gutters', async () => {
    const blocks: Rect[] = [{ x: 100, y: 120, w: 900, h: 420 }, { x: 100, y: 640, w: 420, h: 380 }, { x: 600, y: 640, w: 400, h: 380 }];
    const body = blocks.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#666"/>` + drawing(r, "#eee")).join('');
    const d = await detectPanels(await png(svgPage(body)), 2);
    expect(d.method).toBe('xycut');
    expect(d.panels).toHaveLength(3);
    for (const b of blocks.map(norm)) expect(d.panels.some((p) => overlap(p.region, b) / area(b) > 0.9)).toBe(true);
  });

  it('merges a caption into the picture above it and does not offer text blocks', async () => {
    const pics: Rect[] = [{ x: 100, y: 150, w: 400, h: 400 }, { x: 600, y: 150, w: 400, h: 400 }];
    const body =
      pics.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#777"/>`).join('') +
      textLines(100, 575, 400, 1) + textLines(600, 575, 400, 1) + // captions, 25 px under the pictures
      textLines(100, 900, 900, 12); // a paragraph below
    const d = await detectPanels(await png(svgPage(body)), 0);
    expect(d.method).toBe('xycut');
    expect(d.panels).toHaveLength(2);
    // The caption (bottom edge 584) is inside the panel.
    for (const p of d.panels) expect((p.region.y + p.region.h) * H).toBeGreaterThan(584);
  });

  it('gives a blank page zero panels', async () => {
    expect(await detectPanels(await png(svgPage('')), 3)).toEqual({ pageIndex: 3, method: 'none', panels: [] });
    expect((await detectPanels(await png(svgPage('', '#000')), 3)).panels).toEqual([]);
  });

  it('offers nothing for one full-page figure or a page-sized frame', async () => {
    const full: Rect = { x: 40, y: 40, w: 1020, h: 1420 };
    expect((await detectPanels(await png(svgPage(frame(full, '#333', 4) + drawing(full))), 0)).panels).toEqual([]);
    expect((await detectPanels(await png(svgPage(`<rect x="60" y="60" width="980" height="1380" fill="#888"/>`)), 0)).method).toBe('none');
  });

  it('handles dark backgrounds like light ones', async () => {
    const light = await detectPanels(await png(gridPage()), 0);
    const dark = await detectPanels(await png(gridPage('#eee', 3, '#111', '#eee')), 0);
    expect(dark.method).toBe('frames');
    expectPanels(dark, GRID);
    regionsOf(dark).forEach((r, i) => expect(iou(r, regionsOf(light)[i]!)).toBeGreaterThan(0.97));
  });

  it('copes with scan noise: the grid when it is mild, fewer panels (never invented ones) when it is heavy', async () => {
    const { data, info } = await sharp(await png(gridPage())).greyscale().raw().toBuffer({ resolveWithObject: true });
    const noisy = async (pepper: number, salt: number) => {
      const d = Buffer.from(data);
      let seed = 12345;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
      for (let i = 0; i < d.length; i++) {
        const r = rnd();
        if (r < pepper) d[i] = 0;
        else if (r < pepper + salt) d[i] = 255;
        else d[i] = Math.max(0, Math.min(255, d[i]! + Math.round((rnd() - 0.5) * 40)));
      }
      return detectPanels(await sharp(d, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer(), 0);
    };
    expectPanels(await noisy(0.01, 0.01), GRID);
    for (const [pepper, salt] of [[0.04, 0.02], [0.1, 0.1]] as const) {
      const d = await noisy(pepper, salt);
      expect(d.panels.length).toBeLessThanOrEqual(MAX_PANELS);
      expect(d.panels.length === 0 || d.panels.length >= 2).toBe(true);
      // Whatever it offers follows the grid, not the noise.
      if (d.panels.length > 0) expectPanels(d, GRID);
    }
  });

  it('degrades on pure noise (a photograph-like page): never more than the cap', async () => {
    const data = Buffer.alloc(900 * 1200);
    let seed = 99;
    for (let i = 0; i < data.length; i++) data[i] = ((seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24) % 256;
    const d = await detectPanels(await sharp(data, { raw: { width: 900, height: 1200, channels: 1 } }).png().toBuffer(), 0);
    expect(d.panels.length).toBeLessThanOrEqual(MAX_PANELS);
  });

  it('offers nothing on a skewed page (more than 2 degrees)', async () => {
    const straight = await png(gridPage());
    expect((await detectPanels(straight, 0)).panels).toHaveLength(4);
    const skewed = await sharp(straight).rotate(4, { background: '#fff' }).png().toBuffer();
    expect(await detectPanels(skewed, 0)).toMatchObject({ method: 'none', panels: [] });
    // A tilt inside the limit is tolerated.
    const slight = await sharp(straight).rotate(1, { background: '#fff' }).png().toBuffer();
    expect((await detectPanels(slight, 0)).panels.length).toBeLessThanOrEqual(MAX_PANELS);
  });

  it('is deterministic', async () => {
    const img = await png(gridPage());
    const a = await detectPanels(img, 7);
    const b = await detectPanels(img, 7);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('works on WebP page images (the photo path) and small images', async () => {
    const webp = await sharp(await png(gridPage())).webp({ quality: 90 }).toBuffer();
    expectPanels(await detectPanels(webp, 0), GRID);
    const small = await sharp(await png(gridPage())).resize(500).png().toBuffer();
    expect((await detectPanels(small, 0)).panels).toHaveLength(4);
  });

  it('is fast: well under 500 ms per 1600 px page', async () => {
    const speckled = Buffer.alloc(1200 * 1600);
    let seed = 7;
    for (let i = 0; i < speckled.length; i++) speckled[i] = ((seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24) < 13 ? 0 : 245;
    const pages = [
      await png(gridPage()), await png(svgPage(textLines(100, 100, 900, 40))), await png(svgPage('', '#000')),
      await sharp(speckled, { raw: { width: 1200, height: 1600, channels: 1 } }).png().toBuffer(),
    ];
    const big = await Promise.all(pages.map((p) => sharp(p).resize({ height: 1600, width: 1600, fit: 'inside' }).png().toBuffer()));
    await detectPanels(big[0]!, 0); // warm up
    const times: number[] = [];
    for (const img of big) {
      const t = performance.now();
      await detectPanels(img, 0);
      times.push(performance.now() - t);
    }
    expect(Math.max(...times)).toBeLessThan(500);
  });
});

describe('panel detector: Lumen fixture pages', () => {
  const dir = join(process.cwd(), 'fixtures', 'lumen-bookcase');
  type Ref = { pageIndex: number; panelId?: string; region?: Rect; highlight?: boolean };
  const refs: Ref[] = [];
  const g = fixtureGuide as unknown as { parts: { source: Ref }[]; steps: Record<string, { sources: Ref[]; highlights: { source: Ref }[] }> };
  for (const p of g.parts) refs.push(p.source);
  for (const s of Object.values(g.steps)) refs.push(...s.sources, ...s.highlights.map((h) => ({ ...h.source, highlight: true })));

  it('yields the fixture panel ids, each containing the fixture region that names it', async () => {
    const found = new Map<number, PageDetection>();
    for (let i = 0; i < 6; i++) found.set(i, await detectPanels(readFileSync(join(dir, `page-${i + 1}.png`)), i));
    let checked = 0;
    for (const ref of refs) {
      if (!ref.panelId || !ref.region) continue;
      const panel = found.get(ref.pageIndex)!.panels.find((p) => p.panelId === ref.panelId);
      expect(panel, `${ref.panelId} on page ${ref.pageIndex}`).toBeDefined();
      const containment = overlap(panel!.region, ref.region) / area(ref.region);
      expect(containment, ref.panelId).toBeGreaterThanOrEqual(0.98);
      // A step's crop is the panel; a highlight is a smaller area inside it.
      if (!ref.highlight) expect(iou(panel!.region, ref.region), ref.panelId).toBeGreaterThanOrEqual(0.7);
      checked++;
    }
    expect(checked).toBeGreaterThan(15);
  });
});
