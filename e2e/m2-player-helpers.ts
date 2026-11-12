import { shotDir } from './screenshot-dir';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SHOT = shotDir('m2');

export const VIEWPORTS = {
  '375': { viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true },
  '768': { viewport: { width: 768, height: 1024 }, isMobile: false, hasTouch: false },
  '1280': { viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false },
  landscape: { viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true },
} as const;
export type VpName = keyof typeof VIEWPORTS;

type Checklist = Record<string, 'unchecked' | 'have' | 'missing'>;
export type ProgressBody = { currentStepId: string | null; completedStepIds: string[]; checklist: Checklist };

/** Uploads the Lumen fixture through the API in the context's session and waits for the guide. */
export async function uploadLumen(context: BrowserContext): Promise<{ guideId: string; documentId: string }> {
  const buffer = readFileSync(join(process.cwd(), 'fixtures', 'lumen-bookcase.pdf'));
  const up = await context.request.post('/api/documents', {
    multipart: { files: { name: 'lumen-bookcase.pdf', mimeType: 'application/pdf', buffer } },
  });
  expect(up.ok()).toBeTruthy();
  const { documentId } = (await up.json()) as { documentId: string };
  let guideId: string | null = null;
  await expect
    .poll(
      async () => {
        const d = (await (await context.request.get(`/api/documents/${documentId}`)).json()) as { guideId: string | null };
        guideId = d.guideId;
        return guideId;
      },
      { timeout: 90_000 },
    )
    .not.toBeNull();
  return { guideId: guideId!, documentId };
}

export async function putProgress(context: BrowserContext, guideId: string, body: Partial<ProgressBody> = {}) {
  const r = await context.request.put(`/api/guides/${guideId}/progress`, {
    data: { currentStepId: null, completedStepIds: [], checklist: {}, ...body },
  });
  expect(r.ok()).toBeTruthy();
}

export async function getProgress(context: BrowserContext, guideId: string): Promise<ProgressBody> {
  const r = await context.request.get(`/api/guides/${guideId}`);
  return ((await r.json()) as { progress: ProgressBody }).progress;
}

export async function newContext(browser: Browser, vp: VpName = '375', opts: { reducedMotion?: boolean } = {}): Promise<BrowserContext> {
  return browser.newContext({ ...VIEWPORTS[vp], reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference' });
}

/** Opens the player and waits for the step to be shown. */
export async function openPlayer(page: Page, guideId: string, query = '') {
  await page.goto(`/g/${guideId}/play${query}`);
  await expect(page.getByTestId('step-title')).toBeVisible();
}

export const stepTitle = (page: Page) => page.getByTestId('step-title');
export const visual = (page: Page) => page.getByTestId('source-visual');
export const primary = (page: Page) => page.getByTestId('primary');
export const query = (page: Page) => new URL(page.url()).searchParams;

/** Waits until the page image of the visual has loaded and been laid out. */
export async function visualReady(page: Page) {
  await expect(visual(page)).toHaveAttribute('data-load', 'loaded');
  await expect(page.getByTestId('visual-skeleton')).toHaveCount(0);
  // the 140 ms fade-in of the new picture has finished
  await expect.poll(() => visual(page).locator('img').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
}

/** Real touch swipe through the browser's input pipeline (Playwright has no swipe). */
export async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 6) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (x: number, y: number) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x, y) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

// A loosely typed guide: tests poke at nested fields the fixture lacks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LooseGuide = Record<string, any>;

/** Rewrites GET /api/guides/:id so a test can exercise guide shapes the Lumen fixture lacks. */
export async function patchGuide(page: Page, guideId: string, patch: (guide: LooseGuide) => void) {
  await page.route(`**/api/guides/${guideId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = (await res.json()) as { guide: LooseGuide };
    patch(body.guide);
    await route.fulfill({ response: res, json: body });
  });
}
