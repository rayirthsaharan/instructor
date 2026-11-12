import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { openPlayer, putProgress, SHOT, uploadLumen, visual, visualReady, VIEWPORTS, type VpName } from './m2-player-helpers';

// Layouts at 375 / 768 / 1280 (and phone landscape) with screenshots in artifacts/screenshots/m2/.
let guideId = '';
let state: Awaited<ReturnType<BrowserContext['storageState']>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  mkdirSync(SHOT, { recursive: true });
  const ctx = await browser.newContext();
  ({ guideId } = await uploadLumen(ctx));
  state = await ctx.storageState();
  await ctx.close();
});

async function start(browser: Browser, vp: VpName, scheme: 'light' | 'dark' = 'light') {
  const context = await browser.newContext({ ...VIEWPORTS[vp], storageState: state, colorScheme: scheme });
  await putProgress(context, guideId, { completedStepIds: ['s1'], currentStepId: 's2' });
  const page = await context.newPage();
  return { context, page };
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOT}/player-${name}.png`, animations: 'disabled' });
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

test.describe('375 portrait', () => {
  test('layout, thumb reach, 56px controls, screenshots', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    expect(await noHScroll(page)).toBe(0);
    await expect(page.getByTestId('player')).toHaveAttribute('data-layout', 'phone');

    // visual stage: 42% of the viewport, between 240 and 360
    const v = await box(page, 'source-visual');
    expect(v.x).toBe(0);
    expect(v.width).toBe(375);
    expect(v.height).toBeGreaterThanOrEqual(240);
    expect(v.height).toBeLessThanOrEqual(360);
    // the primary action sits in the lower part of the screen (one-handed reach)
    const p = await box(page, 'primary');
    expect(p.y).toBeGreaterThan(800 * 0.75);
    expect(p.height).toBeGreaterThanOrEqual(55.5);
    expect(p.width).toBeGreaterThanOrEqual(150);
    for (const id of ['back', 'steps-button', 'ask-button']) {
      const b = await box(page, id);
      expect(b.width).toBeGreaterThanOrEqual(55.5);
      expect(b.height).toBeGreaterThanOrEqual(55.5);
    }
    // nothing required in the top third beyond conveniences: the title and primary are below / at the bottom
    await expect(page.getByTestId('primary')).toHaveText('Done - next step');
    expect((await box(page, 'primary')).height).toBeLessThan(60); // label did not wrap to two lines
    await shot(page, '375-step2');

    // text scroll shrinks the stage to 30%
    await page.getByTestId('text-panel').evaluate((e) => e.scrollTo(0, 60));
    await expect(page.getByTestId('player')).toHaveAttribute('data-compact', 'true');
    await shot(page, '375-step2-scrolled');
    await page.getByTestId('text-panel').evaluate((e) => e.scrollTo(0, 0));
    await expect(page.getByTestId('player')).toHaveAttribute('data-compact', 'false');
    await context.close();
  });

  test('screens: steps sheet, original viewer, irreversible, low confidence, part sheet, dark', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    await openPlayer(page, guideId, '?step=s7');
    await visualReady(page);
    await shot(page, '375-irreversible');
    await page.getByTestId('steps-button').click();
    await expect(page.getByRole('dialog', { name: 'Steps' })).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, '375-steps-sheet');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Steps' })).toBeHidden();
    await page.goto(`/g/${guideId}/play?step=s8`);
    await visualReady(page);
    await shot(page, '375-low-confidence');
    await page.goto(`/g/${guideId}/play?step=s2`);
    await visualReady(page);
    await page.getByTestId('original-page').click();
    await expect(page.getByTestId('viewer-page')).toBeVisible();
    await expect(page.getByTestId('viewer-visual')).toHaveAttribute('data-load', 'loaded');
    await shot(page, '375-original');
    await page.getByRole('button', { name: /Page 3 of 6/ }).click();
    await page.waitForTimeout(400);
    await shot(page, '375-original-grid');
    await context.close();

    const dark = await start(browser, '375', 'dark');
    await openPlayer(dark.page, guideId, '?step=s7');
    await visualReady(dark.page);
    await shot(dark.page, '375-dark-irreversible');
    await dark.context.close();
  });

  test('320px: nothing overflows and the primary keeps its width', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, storageState: state });
    const page = await context.newPage();
    await openPlayer(page, guideId, '?step=s2');
    expect(await noHScroll(page)).toBe(0);
    expect((await box(page, 'primary')).width).toBeGreaterThanOrEqual(150);
    // the counter becomes the Steps button
    await expect(page.getByTestId('steps-button')).toBeHidden();
    await page.getByRole('button', { name: /Open the list of steps/ }).click();
    await expect(page.getByRole('dialog', { name: 'Steps' })).toBeVisible();
    await shot(page, '320-steps');
    await context.close();
  });
});

test.describe('768', () => {
  test('inset stage 48%, labelled action bar, sheets', async ({ browser }) => {
    const { context, page } = await start(browser, '768');
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    expect(await noHScroll(page)).toBe(0);
    await expect(page.getByTestId('player')).toHaveAttribute('data-layout', 'tablet');
    const v = await box(page, 'source-visual');
    expect(v.x).toBe(24);
    expect(v.height).toBeGreaterThan(1024 * 0.4);
    expect(v.height).toBeLessThanOrEqual(1024 * 0.5);
    for (const name of ['Back', 'Steps', 'Ask']) await expect(page.getByTestId('action-bar').getByText(name, { exact: true })).toBeVisible();
    const panel = await page.getByTestId('step-content').boundingBox();
    expect(panel!.width).toBeLessThanOrEqual(640);
    await shot(page, '768-step2');
    await page.getByTestId('steps-button').click();
    await expect(page.getByRole('dialog', { name: 'Steps' })).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, '768-steps-sheet');
    await page.keyboard.press('Escape');
    await page.getByTestId('original-page').click();
    await expect(page.getByTestId('viewer-visual')).toHaveAttribute('data-load', 'loaded');
    await shot(page, '768-original');
    await context.close();
  });
});

test.describe('1280', () => {
  test('rail, stage and 420 text column; no Steps button', async ({ browser }) => {
    const { context, page } = await start(browser, '1280');
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    expect(await noHScroll(page)).toBe(0);
    await expect(page.getByTestId('player')).toHaveAttribute('data-layout', 'desktop');
    const rail = await page.getByRole('complementary', { name: 'All steps' }).boundingBox();
    expect(rail!.width).toBe(280);
    await expect(page.getByTestId('steps-button')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Steps' }).locator('[aria-current="step"]')).toContainText('Insert the dowels');
    const text = await page.getByTestId('action-bar').boundingBox();
    expect(text!.width).toBe(420);
    const v = await box(page, 'source-visual');
    expect(v.x).toBeGreaterThanOrEqual(280 + 24);
    expect(v.x + v.width).toBeLessThanOrEqual(1280 - 420 - 24 + 1);
    expect(v.height).toBeGreaterThan(900 - 56 - 60 - 48);
    await shot(page, '1280-step2');
    await page.getByRole('navigation', { name: 'Steps' }).locator('[data-step="s7"]').click();
    await expect(page).toHaveURL(/step=s7/);
    await visualReady(page);
    await shot(page, '1280-irreversible');
    await page.getByTestId('original-page').click();
    await expect(page.getByTestId('viewer-visual')).toHaveAttribute('data-load', 'loaded');
    await expect(page.getByRole('navigation', { name: 'Pages' }).first()).toBeVisible();
    await shot(page, '1280-original');
    await context.close();
  });

  test('1100px: the rail is a 64px strip that expands on focus', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, storageState: state });
    const page = await context.newPage();
    await openPlayer(page, guideId, '?step=s2');
    const rail = page.getByRole('complementary', { name: 'All steps' });
    expect((await rail.boundingBox())!.width).toBe(64);
    await page.getByRole('navigation', { name: 'Steps' }).locator('[data-step="s3"]').focus();
    await expect.poll(async () => (await rail.boundingBox())!.width).toBe(280);
    await context.close();
  });
});

test.describe('phone landscape 667x375', () => {
  test('two columns: visual 56%, text and action bar on the right', async ({ browser }) => {
    const { context, page } = await start(browser, 'landscape');
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    expect(await noHScroll(page)).toBe(0);
    await expect(page.getByTestId('player')).toHaveAttribute('data-layout', 'landscape');
    const v = await box(page, 'source-visual');
    expect(Math.round(v.width / 667 * 100)).toBe(56);
    const bar = await box(page, 'action-bar');
    expect(bar.x).toBeGreaterThan(v.width - 1);
    expect(bar.y + bar.height).toBeGreaterThan(374);
    await expect(page.getByTestId('leave-guide')).toBeVisible();
    await shot(page, 'landscape-step2');
    await context.close();
  });
});

test.describe('visual details', () => {
  test('mark colours and brackets render over the page; dark mode leaves the page white', async ({ browser }) => {
    const { context, page } = await start(browser, '768', 'dark');
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    await expect(visual(page).getByTestId('mark')).toHaveCount(2);
    await shot(page, '768-dark-step2');
    await context.close();
  });
});

test.describe('M2 review fixes (D-017)', () => {
  test('dim wash spares the step region; chips carry callout numbers; Ask is tinted', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    // one hole for the step's own region plus one per highlight
    await expect(visual(page).locator('mask rect[fill="black"]')).toHaveCount(3);
    const chips = page.getByTestId('step-chips');
    await expect(chips.getByTestId('chip-marker')).toHaveText(['1', '2']);
    await expect(chips.locator('img')).toHaveCount(0);
    await expect(visual(page).getByTestId('callout')).toHaveText(['1', '2']);
    const ask = await page.getByTestId('ask-button').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(ask).not.toBe('rgba(0, 0, 0, 0)');
    await context.close();
  });

  test('Marks off hides the status tag with the other marks', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    await openPlayer(page, guideId, '?step=s8');
    await visualReady(page);
    await expect(page.getByTestId('visual-tag')).toBeVisible();
    await page.getByTestId('marks-toggle').click();
    await expect(page.getByTestId('visual-tag')).toHaveCount(0);
    await page.getByTestId('marks-toggle').click();
    await expect(page.getByTestId('visual-tag')).toBeVisible();
    await context.close();
  });

  test('phone landscape: short Primary label with the full name for assistive technology', async ({ browser }) => {
    const { context, page } = await start(browser, 'landscape');
    await openPlayer(page, guideId, '?step=s2');
    await expect(page.getByTestId('primary')).toHaveText('Done');
    await expect(page.getByTestId('primary')).toHaveAccessibleName('Done - next step');
    const b = await box(page, 'primary');
    expect(b.height).toBeLessThanOrEqual(57);
    await context.close();
  });

  for (const vp of ['768', '1280'] as const) {
    test(`${vp}: the Original viewer covers the whole viewport and shows the page without tag or wash`, async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await openPlayer(page, guideId, '?step=s2');
      await visualReady(page);
      await page.getByTestId('original-page').click();
      const viewer = page.getByTestId('original-viewer');
      await expect(page.getByTestId('viewer-visual')).toHaveAttribute('data-load', 'loaded');
      const { width } = VIEWPORTS[vp].viewport;
      const vb = (await viewer.boundingBox())!;
      expect(vb.x).toBe(0);
      expect(Math.round(vb.width)).toBe(width);
      expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(width);
      const fit = page.getByTestId('viewer-visual').getByTestId('zoom-reset');
      const fb = (await fit.boundingBox())!;
      expect(fb.x + fb.width).toBeLessThanOrEqual(width);
      await expect(page.getByTestId('viewer-visual').getByTestId('page-tag')).toHaveCount(0);
      await expect(page.getByTestId('viewer-visual').getByTestId('dim-wash')).toHaveCount(0);
      await expect(page.getByTestId('viewer-visual').getByTestId('mark').first()).toBeVisible();
      await expect(page.locator('[data-testid="page-thumb"]:visible').first()).toBeVisible();
      await context.close();
    });
  }

  test('1280: read-aloud and overflow are right-aligned; the rail has 12px above its first phase; the current row keeps its fill on hover', async ({ browser }) => {
    const { context, page } = await start(browser, '1280');
    await openPlayer(page, guideId, '?step=s2');
    const more = (await page.getByRole('button', { name: 'More options for this guide' }).boundingBox())!;
    expect(more.x + more.width).toBeGreaterThan(1280 - 40);
    const rail = (await page.getByRole('complementary', { name: 'All steps' }).boundingBox())!;
    const firstHeader = (await page.getByRole('navigation', { name: 'Steps' }).locator('h3').first().boundingBox())!;
    expect(firstHeader.y - rail.y).toBeGreaterThanOrEqual(12);
    const current = page.getByRole('navigation', { name: 'Steps' }).locator('[aria-current="step"]');
    const before = await current.evaluate((e) => getComputedStyle(e).backgroundColor);
    await current.hover();
    expect(await current.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(before);
    await context.close();
  });

  test('375: the page grid opens at half height for a short document', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    await page.getByTestId('original-page').click();
    await page.getByRole('button', { name: /Page 3 of 6/ }).click();
    const sheet = page.getByRole('dialog', { name: 'All pages' });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(400);
    const h = (await sheet.locator('.sheet-inner').boundingBox())!.height;
    expect(h).toBeLessThan(800 * 0.6);
    await context.close();
  });
});
