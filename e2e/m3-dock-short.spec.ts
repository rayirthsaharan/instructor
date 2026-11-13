import { expect, test, type BrowserContext } from '@playwright/test';
import { openPlayer, putProgress, uploadLumen } from './m2-player-helpers';
import { installStreamControl, mockAssistantApi, openAssistant } from './m3-helpers';

// D-028: the presentation depends on the window size alone - the modal sheet under 560px tall, the dock from 560 up, on every step.
let guideId = '';
let state: Awaited<ReturnType<BrowserContext['storageState']>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  ({ guideId } = await uploadLumen(ctx));
  state = await ctx.storageState();
  await ctx.close();
});

for (const [height, dock] of [[559, false], [560, true]] as const) {
  test(`1280x${height} step s8: ${dock ? 'dock' : 'sheet'} presentation, same on every step`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height }, storageState: state, reducedMotion: 'reduce' });
    await putProgress(context, guideId, {});
    const page = await context.newPage();
    await installStreamControl(page);
    await mockAssistantApi(page);
    await openPlayer(page, guideId, '?step=s8');
    await openAssistant(page);
    await expect(page.getByTestId('assistant-dock')).toHaveCount(dock ? 1 : 0);
    if (dock) {
      // the dock is the left column: it never reaches under the action bar's column, and the banners stay where they are
      const dockRight = await page.getByTestId('assistant-dock').evaluate((el) => el.getBoundingClientRect().right);
      const barLeft = await page.getByTestId('action-bar').evaluate((el) => el.getBoundingClientRect().left);
      expect(dockRight).toBeLessThanOrEqual(barLeft + 1);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('assistant-panel')).toBeHidden();
    // the step's own banners are what the user returns to
    await expect(page.getByTestId('step-content').locator('[role="note"]').first()).toBeVisible();
    await context.close();
  });
}
