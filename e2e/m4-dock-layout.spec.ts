import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { shotDir } from './screenshot-dir';
import { openPlayer, putProgress, query, uploadLumen } from './m2-player-helpers';
import { answer, askButton, composer, installStreamControl, mockAssistantApi, openAssistant, panelOf, user } from './m3-helpers';

// D-028: the assistant is a dock that takes the step rail's place; the step text panel and the action bar are never touched.
const M4 = shotDir('m4');
let guideId = '';
let state: Awaited<ReturnType<BrowserContext['storageState']>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  ({ guideId } = await uploadLumen(ctx));
  state = await ctx.storageState();
  await ctx.close();
});

const SIZES = [
  { width: 1024, height: 768, dock: 320 },
  { width: 1280, height: 600, dock: 360 },
  { width: 1280, height: 720, dock: 360 },
  { width: 1440, height: 900, dock: 400 },
];
// caution (s5), warning (s9), the irreversible step with a warning (s7), warning + low confidence (s8)
const STEPS = ['s5', 's9', 's7', 's8'];

async function start(browser: import('@playwright/test').Browser, vp: { width: number; height: number }, step: string, opts: { dark?: boolean; history?: ReturnType<typeof user>[] } = {}) {
  const context = await browser.newContext({ viewport: vp, storageState: state, reducedMotion: 'reduce', colorScheme: opts.dark ? 'dark' : 'light' });
  await putProgress(context, guideId, {});
  const page = await context.newPage();
  await installStreamControl(page);
  await mockAssistantApi(page, { history: opts.history });
  await openPlayer(page, guideId, `?step=${step}`);
  return { context, page };
}

const column = (page: Page) =>
  page.evaluate(() => {
    const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number; top: number; bottom: number; left: number; right: number } | undefined;
    const panel = document.querySelector('[data-testid="text-panel"]')!;
    return {
      panel: box('[data-testid="text-panel"]')!,
      scrollTop: panel.scrollTop,
      bar: box('[data-testid="action-bar"]')!,
      primary: box('[data-testid="primary"]')!,
      notes: [...panel.querySelectorAll('[role="note"]')].map((e) => e.getBoundingClientRect().toJSON() as { top: number; bottom: number }),
      title: box('[data-testid="step-title"]')!,
      dock: box('[data-testid="assistant-dock"]') ?? null,
      rail: box('aside[aria-label="All steps"]') ?? null,
      visual: box('[data-testid="source-visual"]')!,
    };
  });

for (const vp of SIZES) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    for (const step of STEPS) {
      test(`step ${step}: the dock replaces the rail and leaves the step text and the action bar exactly as they were`, async ({ browser }) => {
        const { context, page } = await start(browser, vp, step);
        const closed = await column(page);
        expect(closed.dock).toBeNull();
        expect(closed.rail).not.toBeNull();
        expect(closed.notes.length).toBeGreaterThan(0);

        await openAssistant(page);
        await expect(askButton(page)).toHaveAttribute('aria-expanded', 'true');
        const open = await column(page);

        // the rail is replaced (unmounted), the dock sits in its place and takes its width from the picture column
        expect(open.rail).toBeNull();
        expect(open.dock!.left).toBe(0);
        expect(open.dock!.width).toBe(vp.dock);
        expect(open.dock!.top).toBeCloseTo(closed.rail!.top, 0);
        expect(open.dock!.bottom).toBeCloseTo(vp.height, 0);
        expect(open.visual.width).toBeLessThan(closed.visual.width);
        // DOM order = visual order: dock, picture, text panel
        const order = await page.evaluate(() => {
          const pos = (sel: string) => document.querySelector(sel)!;
          const d = pos('[data-testid="assistant-dock"]');
          const v = pos('[data-testid="source-visual"]');
          const t = pos('[data-testid="text-panel"]');
          return [d.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING, v.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING];
        });
        expect(order.every(Boolean)).toBe(true);

        // the right column is untouched: same boxes, same scroll, same banners, same Primary
        expect(open.panel).toEqual(closed.panel);
        expect(open.panel.width).toBe(420);
        expect(open.scrollTop).toBe(closed.scrollTop);
        expect(open.bar).toEqual(closed.bar);
        expect(open.primary).toEqual(closed.primary);
        expect(open.notes).toEqual(closed.notes);
        expect(open.title).toEqual(closed.title);

        // every banner is fully in view in the text panel (above the action bar) with the dock open
        for (const n of open.notes) {
          expect(n.top).toBeGreaterThanOrEqual(open.panel.top - 1);
          expect(n.bottom).toBeLessThanOrEqual(open.panel.bottom + 1);
        }
        await expect(page.getByTestId('primary')).toBeVisible();
        if (step === 's7') await expect(page.getByTestId('primary')).toHaveAccessibleName('I checked - done');
        if (step === 's7') await page.screenshot({ path: `${M4}/${vp.width}x${vp.height}-dock-light.png`, animations: 'disabled' });
        await context.close();
      });
    }

    test('the top-bar counter becomes the Steps button and opens the steps list as a modal left panel', async ({ browser }) => {
      const { context, page } = await start(browser, vp, 's5');
      await expect(page.getByTestId('counter-steps')).toHaveCount(0);
      await openAssistant(page);
      const steps = page.getByTestId('counter-steps');
      await expect(steps).toBeVisible();
      await expect(steps).toHaveAccessibleName('Steps. Step 5 of 10, Join the shelves to the first side');
      await expect(steps).toHaveAttribute('aria-haspopup', 'dialog');
      expect((await steps.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await composer(page).fill('half-typed question');

      await steps.click();
      const panel = page.getByRole('dialog', { name: 'Steps' });
      await expect(panel).toBeVisible();
      const box = (await panel.locator('.sheet-inner').boundingBox())!;
      expect(box.x).toBe(0);
      expect(box.width).toBe(vp.dock);
      expect(box.y + box.height).toBeCloseTo(vp.height, 0);
      await expect(panel.locator('[aria-current="step"]')).toBeFocused();
      await page.screenshot({ path: `${M4}/${vp.width}x${vp.height}-steps-panel.png`, animations: 'disabled' });

      // Esc closes it without moving and returns focus to the counter button
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(steps).toBeFocused();
      expect(query(page).get('step')).toBe('s5');

      // choosing a row goes to that step, closes the panel, keeps the dock and the draft, and focuses the step title
      await steps.click();
      await panel.locator('[data-step="s3"]').click();
      await expect(panel).toBeHidden();
      expect(query(page).get('step')).toBe('s3');
      expect(query(page).get('panel')).toBe('ask');
      await expect(page.getByTestId('assistant-dock')).toBeVisible();
      await expect(composer(page)).toHaveValue('half-typed question');
      await expect(page.getByTestId('step-title')).toBeFocused();
      await expect(page.getByTestId('step-title')).toContainText('Fit the cam bolts');
      await context.close();
    });
  });
}

test('light and dark screenshots at every size for the irreversible step (dark: 1280x720)', async ({ browser }) => {
  const { context, page } = await start(browser, { width: 1280, height: 720 }, 's7', { dark: true });
  await openAssistant(page);
  await page.screenshot({ path: `${M4}/1280x720-dock-dark.png`, animations: 'disabled' });
  await page.getByTestId('counter-steps').click();
  await expect(page.getByRole('dialog', { name: 'Steps' })).toBeVisible();
  await page.screenshot({ path: `${M4}/1280x720-steps-panel-dark.png`, animations: 'disabled' });
  await context.close();
});

test.describe('behaviour', () => {
  test('Ask toggles the dock closed and focus returns to it; Esc outside the dock does not close it; "/" returns to the composer', async ({ browser }) => {
    const { context, page } = await start(browser, { width: 1280, height: 720 }, 's5');
    await openAssistant(page);
    await expect(composer(page)).toBeFocused();
    await page.getByTestId('step-title').focus();
    await page.keyboard.press('Escape');
    await expect(panelOf(page)).toBeVisible(); // 6.4: Esc outside the dock only moves focus to Close
    await expect(page.getByTestId('leave-guide')).toBeFocused();
    await page.getByTestId('step-title').focus();
    await page.keyboard.press('/');
    await expect(composer(page)).toBeFocused();
    await page.keyboard.press('Escape'); // inside the dock: closes it
    await expect(panelOf(page)).toBeHidden();
    await expect(askButton(page)).toBeFocused();
    await expect(page.locator('aside[aria-label="All steps"]')).toHaveCount(1);
    await openAssistant(page);
    await askButton(page).click();
    await expect(panelOf(page)).toBeHidden();
    await expect(askButton(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(askButton(page)).toBeFocused();
    await context.close();
  });

  test('a "Step n" citation chip navigates with the dock open and moves focus to the step title', async ({ browser }) => {
    const history = [user('Where next?', 's5'), answer('See the next part.', 's5', { citations: [{ stepId: 's6', pageIndex: 5 }] })];
    const { context, page } = await start(browser, { width: 1280, height: 720 }, 's5', { history });
    await openAssistant(page);
    await page.getByTestId('cite-step').click();
    expect(query(page).get('step')).toBe('s6');
    await expect(page.getByTestId('assistant-dock')).toBeVisible();
    await expect(page.getByTestId('step-title')).toBeFocused();
    await context.close();
  });

  test('toasts appear in the picture column while the dock is open, not over the composer', async ({ browser }) => {
    const { context, page } = await start(browser, { width: 1280, height: 720 }, 's2');
    await openAssistant(page);
    await page.getByTestId('primary').click();
    const toast = page.getByRole('status').filter({ hasText: 'Step 2 done' });
    await expect(toast).toBeVisible();
    const t = (await toast.boundingBox())!;
    const dock = (await page.getByTestId('assistant-dock').boundingBox())!;
    const panel = (await page.getByTestId('text-panel').boundingBox())!;
    expect(t.x).toBeCloseTo(dock.x + dock.width + 24, 0);
    expect(t.x + t.width).toBeLessThanOrEqual(panel.x - 24 + 1);
    expect(t.y + t.height).toBeCloseTo(720 - 80, 0);
    await page.screenshot({ path: `${M4}/1280x720-dock-toast.png`, animations: 'disabled' });
    await context.close();
  });

  test('resizing across 1024 wide and 560 tall switches dock and sheet without losing the conversation or the composer text', async ({ browser }) => {
    const history = [user('What are the dowels for?', 's5'), answer('They line up the panels.', 's5')];
    const { context, page } = await start(browser, { width: 1280, height: 720 }, 's5', { history });
    await openAssistant(page);
    await expect(page.getByText('They line up the panels.')).toBeVisible();
    await composer(page).fill('a half-typed question');
    const sheet = () => page.evaluate(() => !!document.querySelector('dialog.sheet[open]:modal'));

    for (const [vp, expectDock] of [
      [{ width: 1000, height: 720 }, false],
      [{ width: 1280, height: 720 }, true],
      [{ width: 1280, height: 559 }, false],
      [{ width: 1280, height: 560 }, true],
      [{ width: 1024, height: 560 }, true],
      [{ width: 1023, height: 700 }, false],
    ] as const) {
      await page.setViewportSize(vp);
      if (expectDock) {
        await expect(page.getByTestId('assistant-dock')).toBeVisible();
        expect(await sheet()).toBe(false);
      } else {
        await expect(page.getByTestId('assistant-dock')).toHaveCount(0);
        await expect.poll(sheet).toBe(true);
      }
      await expect(page.getByText('They line up the panels.')).toBeVisible();
      await expect(composer(page)).toHaveValue('a half-typed question');
      expect(query(page).get('panel')).toBe('ask');
    }
    await context.close();
  });
});
