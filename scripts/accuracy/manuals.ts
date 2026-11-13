import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DetectedPanel, PageImage } from '../../src/lib/ai/provider';
import type { Region } from '../../src/lib/guide/schema';
import { parseAnswerKey, type AnswerKey } from './key-schema';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
/** Gitignored (`data/`). Test manuals, rendered pages, run outputs and the cost log live here, never in the repo. */
export const DEFAULT_DATA_DIR = join(REPO_ROOT, 'data', 'accuracy');

export interface ManualInfo {
  id: string;
  kind: 'control' | 'picture-led assembly' | 'text-heavy device setup' | 'mixed';
  title: string;
  /** Direct download URL. */
  url: string;
  /** Host names that must be reachable to download it. */
  hosts: string[];
  licence: string;
  licenceStatedAt: string;
  attribution: string;
  pages: number;
  /** How the file becomes a PDF in `data/accuracy/manuals/<id>/manual.pdf`. */
  obtain: string;
}

/** The selected test manuals (docs/ACCURACY_TEST_PLAN.md section 2). Licences verified 2026-11-13. */
export const MANUALS: ManualInfo[] = [
  {
    id: 'lumen',
    kind: 'control',
    title: 'Lumen 3-shelf bookcase (synthetic fixture)',
    url: 'fixtures/lumen-bookcase.pdf',
    hosts: [],
    licence: 'project-owned sample content',
    licenceStatedAt: 'fixtures/lumen-bookcase/page-N.svg footer',
    attribution: 'Instructor test fixture',
    pages: 6,
    obtain: 'bundled',
  },
  {
    id: 'cyclone-x-axis',
    kind: 'picture-led assembly',
    title: 'BQ Cyclone: 2 Montaje del Eje X (Spanish quick-start assembly guide)',
    url: 'https://raw.githubusercontent.com/CarlosGS/Cyclone-PCB-Factory/master/AssemblyInstructions/Cyclone_QSG_2_Montaje_del_Eje_X.pdf',
    hosts: ['raw.githubusercontent.com'],
    licence: 'CC BY-SA 4.0',
    licenceStatedAt: 'AssemblyInstructions/README.md in github.com/CarlosGS/Cyclone-PCB-Factory (repo README says CC BY-SA 3.0)',
    attribution: 'Original instructions by bq; Cyclone PCB Factory by Carlos Garcia Saura (CarlosGS) and contributors',
    pages: 14,
    obtain: 'download',
  },
  {
    id: 'anavi-thermometer',
    kind: 'text-heavy device setup',
    title: "ANAVI Thermometer User's Manual",
    url: 'https://raw.githubusercontent.com/AnaviTechnology/anavi-docs/master/anavi-thermometer/anavi-thermometer.md',
    hosts: ['raw.githubusercontent.com'],
    licence: 'CC BY-SA 4.0',
    licenceStatedAt: 'line 14 of the manual itself, and README.md of github.com/AnaviTechnology/anavi-docs',
    attribution: 'ANAVI Technology',
    pages: 12,
    obtain: 'published as Markdown only: render once to A4 PDF with a pinned converter and keep the PDF hash in the key (plan section 2)',
  },
  {
    id: 'cyclone-electronics',
    kind: 'mixed',
    title: 'BQ Cyclone: 4 Montaje de la Electronica (Spanish quick-start guide, wiring table and soldering)',
    url: 'https://raw.githubusercontent.com/CarlosGS/Cyclone-PCB-Factory/master/AssemblyInstructions/Cyclone_QSG_4_Montaje_de_la_Electronica.pdf',
    hosts: ['raw.githubusercontent.com'],
    licence: 'CC BY-SA 4.0',
    licenceStatedAt: 'AssemblyInstructions/README.md in github.com/CarlosGS/Cyclone-PCB-Factory (repo README says CC BY-SA 3.0)',
    attribution: 'Original instructions by bq; Cyclone PCB Factory by Carlos Garcia Saura (CarlosGS) and contributors',
    pages: 12,
    obtain: 'download',
  },
];

export interface LoadedManual {
  info: ManualInfo;
  key: AnswerKey;
  pages: PageImage[];
  /** Plain text per page (index = pageIndex); empty strings when a page has none. */
  pageTexts: string[];
  /** Code-detected panels per page; `undefined` until the panel detector has produced `panels.json`. */
  panels?: { pageIndex: number; panels: DetectedPanel[] }[];
}

export function loadKey(id: string, keysDir = join(HERE, 'keys')): AnswerKey {
  const path = join(keysDir, `${id}.key.json`);
  if (!existsSync(path)) throw new Error(`No answer key for "${id}" at ${path}. QA builds it before any paid run (plan section 4).`);
  return parseAnswerKey(JSON.parse(readFileSync(path, 'utf8')));
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Text of an SVG page, one line per <text> element. */
export function svgPageText(svg: string): string {
  return [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => decodeXml(m[1]!)).join('\n');
}

/**
 * Panels of a synthetic SVG page: its dashed frames, normalised by the viewBox, ids in reading order
 * (`p<page number>-a`, `-b`, ...). This is ground truth for the fixture, not the production detector.
 */
export function svgPagePanels(svg: string, pageIndex: number): DetectedPanel[] {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!vb) return [];
  const [vw, vh] = [Number(vb[1]), Number(vb[2])];
  const regions: Region[] = [];
  for (const m of svg.matchAll(/<rect\b([^>]*)\/?>/g)) {
    const attrs = m[1]!;
    if (!attrs.includes('stroke-dasharray')) continue;
    const num = (name: string) => Number(new RegExp(`\\b${name}="([\\d.]+)"`).exec(attrs)?.[1] ?? NaN);
    const r = { x: num('x') / vw, y: num('y') / vh, w: num('width') / vw, h: num('height') / vh };
    if ([r.x, r.y, r.w, r.h].every(Number.isFinite)) regions.push(roundRegion(r));
  }
  return orderPanels(regions).map((region, i) => ({ panelId: `p${pageIndex + 1}-${String.fromCharCode(97 + i)}`, region }));
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const roundRegion = (r: Region): Region => ({ x: round4(r.x), y: round4(r.y), w: round4(r.w), h: round4(r.h) });

/** Reading order: rows top to bottom (tops within 2% of the page are one row), then left to right. */
export function orderPanels(regions: Region[]): Region[] {
  const sorted = [...regions].sort((a, b) => a.y - b.y);
  const rows: Region[][] = [];
  for (const r of sorted) {
    const row = rows.find((rw) => Math.abs(rw[0]!.y - r.y) <= 0.02);
    if (row) row.push(r);
    else rows.push([r]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

export function loadLumen(root = REPO_ROOT): LoadedManual {
  const info = MANUALS.find((m) => m.id === 'lumen')!;
  const dir = join(root, 'fixtures', 'lumen-bookcase');
  const pages: PageImage[] = [];
  const pageTexts: string[] = [];
  const panels: { pageIndex: number; panels: DetectedPanel[] }[] = [];
  for (let i = 0; i < info.pages; i++) {
    pages.push({ index: i, mimeType: 'image/png', data: new Uint8Array(readFileSync(join(dir, `page-${i + 1}.png`))) });
    const svg = readFileSync(join(dir, `page-${i + 1}.svg`), 'utf8');
    pageTexts.push(svgPageText(svg));
    const p = svgPagePanels(svg, i);
    if (p.length > 0) panels.push({ pageIndex: i, panels: p });
  }
  return { info, key: loadKey('lumen'), pages, pageTexts, panels };
}

/** Layout of a prepared manual under `data/accuracy/manuals/<id>/`. */
export function manualDir(dataDir: string, id: string): string {
  return join(dataDir, 'manuals', id);
}

export function loadPrepared(id: string, dataDir = DEFAULT_DATA_DIR): LoadedManual {
  if (id === 'lumen') return loadLumen();
  const info = MANUALS.find((m) => m.id === id);
  if (!info) throw new Error(`Unknown manual "${id}". Known: ${MANUALS.map((m) => m.id).join(', ')}`);
  const dir = manualDir(dataDir, id);
  const textsPath = join(dir, 'texts.json');
  if (!existsSync(textsPath)) throw new Error(`Manual "${id}" is not prepared. Put the PDF at ${join(dir, 'manual.pdf')} and run: npx tsx scripts/accuracy/run.ts prepare --manual ${id}`);
  const pageTexts = JSON.parse(readFileSync(textsPath, 'utf8')) as string[];
  const pages: PageImage[] = pageTexts.map((_, i) => ({ index: i, mimeType: 'image/png', data: new Uint8Array(readFileSync(join(dir, 'pages', `page-${i + 1}.png`))) }));
  const panelsPath = join(dir, 'panels.json');
  const panels = existsSync(panelsPath) ? (JSON.parse(readFileSync(panelsPath, 'utf8')) as LoadedManual['panels']) : undefined;
  return { info, key: loadKey(id), pages, pageTexts, panels };
}

/** Renders `manual.pdf` with the production renderer (same resolution the pipeline uses) into pages/ and texts.json. */
export async function prepareManual(id: string, dataDir = DEFAULT_DATA_DIR): Promise<{ pages: number }> {
  const { probePdf, renderPdfPages } = await import('../../src/lib/render/pdf');
  const { PAGE_IMAGE_MAX_DIM } = await import('../../src/lib/limits');
  const dir = manualDir(dataDir, id);
  const pdf = new Uint8Array(readFileSync(join(dir, 'manual.pdf')));
  const { pageCount } = await probePdf(pdf);
  mkdirSync(join(dir, 'pages'), { recursive: true });
  const texts: string[] = new Array(pageCount).fill('');
  await renderPdfPages(
    pdf,
    Array.from({ length: pageCount }, (_, i) => i),
    async (p) => {
      writeFileSync(join(dir, 'pages', `page-${p.index + 1}.png`), p.png);
      texts[p.index] = p.text;
    },
    { maxDim: PAGE_IMAGE_MAX_DIM },
  );
  writeFileSync(join(dir, 'texts.json'), JSON.stringify(texts, null, 2));
  return { pages: pageCount };
}
