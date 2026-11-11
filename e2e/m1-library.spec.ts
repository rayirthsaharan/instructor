import { expect, test } from '@playwright/test';
import { FakeApi, guide, newPage, noHorizontalScroll, SHOT, VIEWPORTS, type VpName } from './m1-helpers';

const shots: VpName[] = ['375', '1280'];

const populated = () => [
  guide({ id: 'g1', documentId: 'd1', title: 'Lumen 3-shelf bookcase assembly', progress: { currentStepId: 's7', completedCount: 6, percent: 25 }, updatedAt: Date.parse('2026-11-11T10:00:00Z') }),
  guide({ id: 'g2', documentId: 'd2', title: 'Brio espresso machine setup', stepCount: 12, estimatedMinutes: 20, updatedAt: Date.parse('2026-11-10T10:00:00Z') }),
  guide({ id: 'g3', documentId: 'd3', title: 'Nova bike light installation', stepCount: 8, estimatedMinutes: null, progress: { currentStepId: null, completedCount: 8, percent: 100 }, updatedAt: Date.parse('2026-11-09T10:00:00Z') }),
  guide({ id: null, documentId: 'd4', title: null, status: 'processing', stepCount: 0, estimatedMinutes: null, updatedAt: Date.parse('2026-11-08T10:00:00Z') }),
  guide({ id: null, documentId: 'd5', title: null, status: 'failed', stepCount: 0, estimatedMinutes: null, updatedAt: Date.parse('2026-11-07T10:00:00Z') }),
];

for (const scheme of ['light', 'dark'] as const) {
  for (const vp of shots) {
    test(`library ${scheme} @ ${vp}: empty, loading, error and populated states`, async ({ browser }) => {
      const { page, context } = await newPage(browser, vp, scheme);
      const api = new FakeApi();
      await api.install(page);

      // Empty (first run)
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Turn any manual into clear steps' })).toBeVisible();
      await expect(page.getByText("Add the PDF, or take photos of the paper booklet. We'll mark up the manual's own pictures, one step at a time.")).toBeVisible();
      await expect(page.getByText('Check your parts first')).toBeVisible();
      await expect(page.getByText('Guides are saved on this device.')).toBeVisible();
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOT}/library-empty-${vp}-${scheme}.png`, fullPage: true });

      // Loading
      api.guidesDelayMs = 1500;
      api.guides = populated();
      await page.goto('/');
      await expect(page.getByRole('status').getByText('Loading')).toBeAttached();
      await page.screenshot({ path: `${SHOT}/library-loading-${vp}-${scheme}.png`, fullPage: true });

      // Error, then recover
      api.guidesDelayMs = 0;
      api.guidesFail = true;
      await page.goto('/');
      await expect(page.getByText("We couldn't load your guides.")).toBeVisible();
      await expect(page.getByRole('link', { name: 'Add a manual' }).first()).toBeVisible();
      await page.screenshot({ path: `${SHOT}/library-error-${vp}-${scheme}.png`, fullPage: true });
      api.guidesFail = false;
      await page.getByRole('button', { name: 'Try again' }).click();

      // Populated
      await expect(page.getByTestId('continue-hero')).toBeVisible();
      await expect(page.getByTestId('guide-card')).toHaveCount(5);
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOT}/library-populated-${vp}-${scheme}.png`, fullPage: true });
      await context.close();
    });
  }
}

test('populated library: copy, states, links, sorting and hero', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.guides = populated();
  await api.install(page);
  await page.goto('/');

  const hero = page.getByTestId('continue-hero');
  await expect(hero.getByRole('heading', { name: 'Lumen 3-shelf bookcase assembly' })).toBeVisible();
  await expect(hero.getByText('Step 7 of 24')).toBeVisible();
  await expect(hero.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/g/g1/play');

  const cards = page.getByTestId('guide-card');
  await expect(cards.nth(0)).toHaveAttribute('data-state', 'inProgress');
  await expect(cards.nth(0).getByRole('link')).toHaveAttribute('href', '/g/g1/play');
  await expect(cards.nth(0)).toContainText('24 steps - about 90 min');
  await expect(cards.nth(1)).toHaveAttribute('data-state', 'ready');
  await expect(cards.nth(1).getByRole('link')).toHaveAttribute('href', '/g/g2');
  await expect(cards.nth(2)).toContainText('Finished');
  await expect(cards.nth(2)).toContainText('8 steps');
  await expect(cards.nth(2)).not.toContainText('about');
  await expect(cards.nth(3)).toContainText('Reading your manual');
  await expect(cards.nth(3).getByRole('link')).toHaveAttribute('href', '/d/d4');
  await expect(cards.nth(4)).toContainText("Couldn't finish - Try again");
  await expect(cards.nth(4).getByRole('link')).toHaveAttribute('href', '/d/d5');
  await context.close();
});

test('delete: menu, confirm copy, Cancel keeps it, Delete removes it with a toast', async ({ browser }) => {
  const { page, context } = await newPage(browser, '375');
  const api = new FakeApi();
  api.guides = populated();
  await api.install(page);
  await page.goto('/');

  const trigger = page.getByRole('button', { name: 'More actions for Brio espresso machine setup' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Open overview' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this guide?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("The guide and the uploaded manual will be removed from this device's library.");
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.screenshot({ path: `${SHOT}/library-delete-confirm-375-light.png` });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('guide-card')).toHaveCount(5);

  await trigger.click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Guide deleted')).toBeVisible();
  await expect(page.getByTestId('guide-card')).toHaveCount(4);
  expect(api.calls).toContain('DELETE /api/guides/g2');
  await context.close();
});

test('delete failure shows an error banner with Try again, not a toast', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.guides = populated();
  await api.install(page);
  await page.route('**/api/guides/g2', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"x","message":"y"}}' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'More actions for Brio espresso machine setup' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('[data-kind="error"]')).toContainText("We couldn't delete that guide.");
  await expect(page.getByTestId('guide-card')).toHaveCount(5);
  await context.close();
});

test('a processing manual that finishes while the Library is open shows "Your guide is ready" + Open', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.guides = [guide({ id: null, documentId: 'd9', title: null, status: 'processing', stepCount: 0, estimatedMinutes: null })];
  await api.install(page);
  await page.goto('/');
  await expect(page.getByTestId('guide-card')).toContainText('Reading your manual');
  api.guides = [guide({ id: 'g9', documentId: 'd9', title: 'Pico toaster manual', status: 'ready' })];
  await expect(page.getByText('Your guide is ready')).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(/\/g\/g9$/);
  await expect(page.getByRole('heading', { name: 'Pico toaster manual' })).toBeVisible();
  await expect(page.getByText('Guide overview coming next')).toBeVisible();
  await context.close();
});

test('1280: the hero sits beside a drop tile; dropping a file goes to Capture with it', async ({ browser }) => {
  const { page, context } = await newPage(browser, '1280');
  const api = new FakeApi();
  api.guides = populated();
  await api.install(page);
  await page.goto('/');
  const tile = page.getByRole('link', { name: /Add a manual.*Drop a PDF/ });
  await expect(tile).toBeVisible();
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File([new Uint8Array(1024)], 'dropped.pdf', { type: 'application/pdf' }));
    return d;
  });
  await tile.dispatchEvent('drop', { dataTransfer: dt });
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByTestId('pdf-row')).toContainText('dropped.pdf');
  expect(VIEWPORTS['1280'].viewport.width).toBe(1280);
  await context.close();
});
