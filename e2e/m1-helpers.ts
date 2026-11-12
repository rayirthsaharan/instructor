import { shotDir } from './screenshot-dir';
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';

export type Doc = {
  id: string;
  status: 'queued' | 'processing' | 'ready' | 'failed' | 'rejected';
  stage: 'ingest' | 'render' | 'analyse' | 'verify' | 'publish' | null;
  progress: number;
  pageCount: number | null;
  pagesRendered: number | null;
  guideId: string | null;
  error: { code: string; message: string } | null;
  title: string | null;
  attempts?: number;
  retryCount?: number;
};

export type GuideRow = {
  id: string | null;
  documentId: string;
  title: string | null;
  stepCount: number;
  estimatedMinutes: number | null;
  progress: { currentStepId: string | null; currentStepTitle?: string | null; completedCount: number; percent: number };
  status: 'queued' | 'processing' | 'ready' | 'failed' | 'rejected';
  updatedAt: number;
  thumbnailPage: number | null;
};

export const doc = (over: Partial<Doc> = {}): Doc => ({
  id: 'doc1',
  status: 'processing',
  stage: 'render',
  progress: 0.2,
  pageCount: 20,
  pagesRendered: 8,
  guideId: null,
  error: null,
  title: null,
  ...over,
});

export const guide = (over: Partial<GuideRow> = {}): GuideRow => ({
  id: 'g1',
  documentId: 'doc1',
  title: 'Lumen 3-shelf bookcase assembly',
  stepCount: 24,
  estimatedMinutes: 90,
  progress: { currentStepId: null, completedCount: 0, percent: 0 },
  status: 'ready',
  updatedAt: Date.parse('2026-11-11T10:00:00Z'),
  thumbnailPage: 0,
  ...over,
});

/** Mutable fake of the M1 HTTP contract. Tests change its fields between steps. */
export class FakeApi {
  guides: GuideRow[] = [];
  guidesDelayMs = 0;
  guidesFail = false;
  docs: Record<string, Doc | (() => Doc) | 404> = {};
  docFail = false;
  upload: { status: number; body: unknown } = { status: 201, body: { documentId: 'doc1' } };
  uploadAbort = false;
  retryStatus = 200;
  calls: string[] = [];
  uploadedNames: string[] = [];

  async install(page: Page) {
    await page.route('**/api/**', (route) => this.handle(route));
  }

  private json(route: Route, status: number, body: unknown) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  }

  private async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const key = `${req.method()} ${path}`;
    this.calls.push(key);

    if (/\/pages\/\d+\/image$/.test(path)) {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PAGE_SVG });
    }
    if (key === 'POST /api/documents') {
      const buf = req.postDataBuffer()?.toString('latin1') ?? '';
      this.uploadedNames = [...buf.matchAll(/filename="([^"]+)"/g)].map((m) => m[1] ?? '');
      if (this.uploadAbort) return route.abort('connectionreset');
      return this.json(route, this.upload.status, this.upload.body);
    }
    if (key === 'GET /api/guides') {
      if (this.guidesDelayMs) await new Promise((r) => setTimeout(r, this.guidesDelayMs));
      if (this.guidesFail) return this.json(route, 500, { error: { code: 'internal', message: 'boom' } });
      return this.json(route, 200, this.guides);
    }
    const del = /^\/api\/guides\/([^/]+)$/.exec(path);
    if (del && req.method() === 'DELETE') {
      this.guides = this.guides.filter((g) => g.id !== del[1]);
      return route.fulfill({ status: 204 });
    }
    const delDoc = /^\/api\/documents\/([^/]+)$/.exec(path);
    if (delDoc && req.method() === 'DELETE') {
      this.guides = this.guides.filter((g) => g.documentId !== delDoc[1]);
      return this.json(route, 200, { deleted: true });
    }
    const retry = /^\/api\/documents\/([^/]+)\/retry$/.exec(path);
    if (retry && req.method() === 'POST') {
      return this.json(route, this.retryStatus, {});
    }
    const get = /^\/api\/documents\/([^/]+)$/.exec(path);
    if (get && req.method() === 'GET') {
      if (this.docFail) return route.abort('connectionreset');
      const d = this.docs[get[1] ?? ''];
      if (d === undefined || d === 404) return this.json(route, 404, { error: { code: 'not_found', message: 'No such document' } });
      return this.json(route, 200, typeof d === 'function' ? d() : d);
    }
    return this.json(route, 404, { error: { code: 'not_found', message: 'unmocked' } });
  }
}

const PAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect width="300" height="400" fill="#fff"/><rect x="30" y="40" width="240" height="14" fill="#bbb"/><rect x="30" y="70" width="180" height="10" fill="#ddd"/><rect x="60" y="130" width="180" height="140" fill="none" stroke="#999" stroke-width="3"/><rect x="30" y="300" width="240" height="10" fill="#ddd"/><rect x="30" y="320" width="200" height="10" fill="#ddd"/></svg>`;

export const VIEWPORTS = {
  '375': { viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true },
  '768': { viewport: { width: 768, height: 1000 }, isMobile: false, hasTouch: false },
  '1280': { viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false },
} as const;
export type VpName = keyof typeof VIEWPORTS;

export async function newPage(browser: Browser, vp: VpName, scheme: 'light' | 'dark' = 'light'): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ ...VIEWPORTS[vp], colorScheme: scheme });
  const page = await context.newPage();
  return { page, context };
}

export async function noHorizontalScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** A minimal valid-looking file for setInputFiles. */
export const pdfFile = (name = 'manual.pdf', bytes = 2048) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes)]),
});

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
export const photoFile = (n: number) => ({ name: `page-${n}.png`, mimeType: 'image/png', buffer: PNG });

export const SHOT = shotDir('m1');

/** Serves the Lumen guide (retitled) at /api/guides/<id> so the real Overview renders for a fake-API guide. */
export async function routeGuide(page: Page, id: string, title: string) {
  const { readFileSync } = await import('node:fs');
  const g = JSON.parse(readFileSync('fixtures/lumen-bookcase.guide.json', 'utf8')) as Record<string, unknown>;
  await page.route(`**/api/guides/${id}`, (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ documentId: 'doc-fake', guide: { ...g, title }, progress: null, pageCount: 6 }) }),
  );
}
