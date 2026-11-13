import { expect, test, type BrowserContext } from '@playwright/test';
import { openPlayer, putProgress, uploadLumen } from './m2-player-helpers';
import { installStreamControl, mockAssistantApi, openAssistant } from './m3-helpers';

// D-022 item 7 / M4-a: under 560px tall the assistant is the modal sheet; taller, it is the dock when the pinned banners leave the chat its minimum height (900 fits every step).
let guideId = '';
let state: Awaited<ReturnType<BrowserContext['storageState']>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  ({ guideId } = await uploadLumen(ctx));
  state = await ctx.storageState();
  await ctx.close();
});

for (const [height, dock] of [[559, false], [900, true]] as const) {
  test(`1280x${height} step s8: ${dock ? 'dock' : 'sheet'} presentation, banners never under the action bar`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height }, storageState: state, reducedMotion: 'reduce' });
    await putProgress(context, guideId, {});
    const page = await context.newPage();
    await installStreamControl(page);
    await mockAssistantApi(page);
    await openPlayer(page, guideId, '?step=s8');
    await openAssistant(page);
    await expect(page.getByTestId('assistant-dock')).toHaveCount(dock ? 1 : 0);
    if (dock) {
      const barTop = await page.getByTestId('action-bar').evaluate((el) => el.getBoundingClientRect().top);
      const dockBottom = await page.getByTestId('assistant-dock').evaluate((el) => el.getBoundingClientRect().bottom);
      expect(dockBottom).toBeLessThanOrEqual(barTop + 1);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('assistant-panel')).toBeHidden();
    // the step's own banners are what the user returns to
    await expect(page.getByTestId('step-content').locator('[role="note"]').first()).toBeVisible();
    await context.close();
  });
}
