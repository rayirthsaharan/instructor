import { expect, test } from '@playwright/test';
import { openPlayer, putProgress, uploadLumen, visual, VIEWPORTS } from './m2-player-helpers';

// QA M2 re-check: the image-error block must stay mounted until the user acts (no re-mount on refresh, focus, URL sync).
test('the image error block is never removed or re-created while nothing was clicked', async ({ browser }) => {
  const ctx0 = await browser.newContext();
  const { guideId } = await uploadLumen(ctx0);
  const state = await ctx0.storageState();
  await ctx0.close();
  const context = await browser.newContext({ ...VIEWPORTS['375'], storageState: state });
  await putProgress(context, guideId, {});
  const page = await context.newPage();
  await page.route('**/api/documents/*/pages/*/image', (r) => r.abort());
  await openPlayer(page, guideId, '?step=s2');
  await expect(visual(page)).toHaveAttribute('data-load', 'error');
  await page.evaluate(() => {
    const w = window as unknown as { __mut: number; __btn: Element | null };
    w.__mut = 0;
    const find = () => document.querySelector('[data-testid="source-visual"] [data-no-gesture] button');
    w.__btn = find();
    new MutationObserver(() => {
      const b = find();
      if (b !== w.__btn) {
        w.__mut++;
        w.__btn = b;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  // everything the app does on its own: focus/visibility refresh, URL sync, a save, time passing
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(3000);
  await expect(visual(page)).toHaveAttribute('data-load', 'error');
  const changes = await page.evaluate(() => (window as unknown as { __mut: number }).__mut);
  expect(changes, 'error block was replaced without user action').toBe(0);
  await context.close();
});
