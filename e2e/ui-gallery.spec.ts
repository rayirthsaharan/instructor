import { test, expect } from '@playwright/test';

const viewports = [
  { name: '375', width: 375, height: 800 },
  { name: '1280', width: 1280, height: 900 },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const vp of viewports) {
    test(`/dev/ui ${scheme} @ ${vp.name}: no horizontal scroll, key primitives visible`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: scheme,
      });
      const page = await context.newPage();
      await page.goto('/dev/ui');
      await expect(page.getByRole('heading', { name: 'UI gallery' })).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);

      await expect(page.getByRole('button', { name: 'Continue' }).first()).toBeVisible();
      await expect(page.getByRole('checkbox').first()).toBeVisible();
      await expect(page.getByRole('progressbar').first()).toBeVisible();
      await expect(page.getByText('Caution', { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Can't be undone")).toBeVisible();
      await expect(page.getByText('From your manual').first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open manual page 12, step 7' }).first()).toBeVisible();

      // Theme actually applied.
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe(scheme === 'dark' ? 'rgb(20, 19, 16)' : 'rgb(246, 243, 236)');

      await page.screenshot({ path: `test-results/ui-gallery-${scheme}-${vp.name}.png`, fullPage: true });
      await context.close();
    });
  }
}

test('manual theme override wins over the OS scheme', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto('/dev/ui?theme=dark');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(20, 19, 16)');
  await context.close();
});

test('bottom sheet: focus moves to title, Tab is trapped, Escape closes and restores focus', async ({ page }) => {
  await page.goto('/dev/ui');
  const opener = page.getByRole('button', { name: 'Open bottom sheet' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Cam lock' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cam lock' })).toBeFocused();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('confirm dialog focuses Cancel and closes on scrim click', async ({ page }) => {
  await page.goto('/dev/ui');
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.mouse.click(5, 5);
  await expect(page.getByRole('dialog')).toBeHidden();
});
