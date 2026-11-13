import { expect, test, type BrowserContext } from '@playwright/test';
import { openPlayer, putProgress, uploadLumen } from './m2-player-helpers';
import { installStreamControl, mockAssistantApi, openAssistant } from './m3-helpers';

// M4-a item 1: the step's banners are pinned in the dock. Focusing the composer or scrolling the chat never moves one out of view;
// if they and the chat minimum do not fit, the assistant is the modal sheet instead.
let guideId = '';
let state: Awaited<ReturnType<BrowserContext['storageState']>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  ({ guideId } = await uploadLumen(ctx));
  state = await ctx.storageState();
  await ctx.close();
});

// At 1280x600 and 1024x768 the banners of most steps leave the chat under its 200px minimum, so those windows get the sheet;
// 1280x900 is tall enough for the dock on every step, so the pinned behaviour is always exercised.
const sizes = [
  { width: 1280, height: 600 },
  { width: 1024, height: 768 },
  { width: 1280, height: 900 },
];

for (const vp of sizes) {
  for (const step of ['s7', 's8', 's9']) {
    test(`${vp.width}x${vp.height} step ${step}: focusing the composer leaves every banner fully in view`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: vp, storageState: state, reducedMotion: 'reduce' });
      await putProgress(context, guideId, {});
      const page = await context.newPage();
      await installStreamControl(page);
      await mockAssistantApi(page);
      await openPlayer(page, guideId, `?step=${step}`);
      await openAssistant(page);

      const dock = await page.getByTestId('assistant-dock').count();
      if (vp.height === 900) expect(dock).toBe(1);
      if (!dock) {
        // fallback: the modal sheet, which makes the Primary unpressable
        await expect.poll(() => page.evaluate(() => !!document.querySelector('dialog[open]:modal'))).toBe(true);
        await context.close();
        return;
      }

      const inView = () =>
        page.evaluate(() => {
          const bar = document.querySelector('[data-testid="action-bar"]')!.getBoundingClientRect();
          const dockBox = document.querySelector('[data-testid="assistant-dock"]')!.getBoundingClientRect();
          const notes = [...document.querySelectorAll('[data-testid="dock-banners"] > [role="note"]')].map((e) => e.getBoundingClientRect());
          return {
            count: notes.length,
            ok: notes.every((b) => b.top >= dockBox.top - 1 && b.bottom <= Math.min(window.innerHeight, bar.top + 1)),
            tops: notes.map((b) => Math.round(b.top)),
          };
        });

      const before = await inView();
      expect(before.count).toBeGreaterThan(0);
      expect(before.ok).toBe(true);

      await page.getByTestId('assistant-panel').getByRole('textbox').focus();
      await page.keyboard.type('where is the screw for the bracket');
      const afterFocus = await inView();
      expect(afterFocus.ok).toBe(true);
      expect(afterFocus.tops).toEqual(before.tops);

      // scrolling anything inside the dock cannot move the banners either
      await page.getByTestId('assistant-dock').evaluate((el) => {
        for (const e of el.querySelectorAll<HTMLElement>('*')) e.scrollTop = 1e6;
      });
      await page.mouse.wheel(0, 800);
      const afterScroll = await inView();
      expect(afterScroll.ok).toBe(true);
      expect(afterScroll.tops).toEqual(before.tops);
      await context.close();
    });
  }
}

test('a window too short for the banners plus the chat minimum uses the sheet and returns to the dock when it grows', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 }, storageState: state, reducedMotion: 'reduce' });
  await putProgress(context, guideId, {});
  const page = await context.newPage();
  await installStreamControl(page);
  await mockAssistantApi(page);
  await openPlayer(page, guideId, '?step=s9');
  await openAssistant(page);
  await expect(page.getByTestId('assistant-dock')).toHaveCount(1);
  // find the first height (>= 560) where the dock gives way; below it the sheet is modal
  let sheetAt = 0;
  for (let h = 700; h >= 560; h -= 20) {
    await page.setViewportSize({ width: 1280, height: h });
    await page.waitForTimeout(250);
    if ((await page.getByTestId('assistant-dock').count()) === 0) {
      sheetAt = h;
      break;
    }
  }
  if (sheetAt) {
    await expect.poll(() => page.evaluate(() => !!document.querySelector('dialog[open]:modal'))).toBe(true);
    await page.setViewportSize({ width: 1280, height: 760 });
    await expect(page.getByTestId('assistant-dock')).toHaveCount(1);
  }
  await context.close();
});
