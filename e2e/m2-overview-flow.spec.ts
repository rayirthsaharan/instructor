import { expect, test } from '@playwright/test';
import { putProgress, row, SHOT, uploadLumen } from './m2-overview-helpers';

// Un-mocked: real API, worker and mock provider (playwright.config.ts). Each test has its own session.

test('checklist states persist across reload; a missing part lists the steps it blocks', async ({ page }) => {
  const { guideId } = await uploadLumen(page);
  await page.goto(`/g/${guideId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Lumen 3-shelf bookcase' })).toBeVisible();
  await expect(page.getByText("Here's the plan")).toBeVisible();
  await expect(page.getByTestId('prep-row')).toHaveCount(12);
  await expect(page.getByTestId('readiness')).toHaveText('0 of 12 checked');

  const openRowMenu = async (name: string) => {
    await row(page, name).getByRole('button', { name: `More options for ${name}` }).click();
  };
  const save = () => page.waitForResponse((r) => r.url().endsWith('/progress') && r.request().method() === 'PATCH');
  let saved = save();
  await row(page, 'Shelf').getByRole('checkbox').click();
  await expect(row(page, 'Shelf')).toHaveAttribute('data-state', 'have');
  await expect(row(page, 'Shelf').getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('readiness')).toHaveText('1 of 12 checked');
  await saved;

  saved = save();
  await openRowMenu('Cam lock');
  await page.getByRole('menuitem', { name: "I'm missing this" }).click();
  await expect(row(page, 'Cam lock')).toHaveAttribute('data-state', 'missing');
  await expect(row(page, 'Cam lock')).toContainText('Marked missing');
  await expect(row(page, 'Cam lock')).toContainText('Needed in step');
  await expect(row(page, 'Cam lock').getByRole('link', { name: 'Step 4' })).toHaveAttribute('href', new RegExp(`/g/${guideId}/play\\?step=s4`));
  await expect(page.getByTestId('readiness')).toHaveText('1 part marked missing');
  await expect(page.getByTestId('missing-sentence')).toHaveText('You can do steps 1-3 before you need it.');
  await saved;

  await page.reload();
  await expect(row(page, 'Shelf')).toHaveAttribute('data-state', 'have');
  await expect(row(page, 'Cam lock')).toHaveAttribute('data-state', 'missing');
  await expect(page.getByTestId('readiness')).toHaveText('1 part marked missing');

  saved = save();
  await openRowMenu('Cam lock');
  await page.getByRole('menuitem', { name: 'I found it' }).click();
  await expect(row(page, 'Cam lock')).toHaveAttribute('data-state', 'unchecked');
  await saved;
});

test('parts show a crop of the manual page; tools say when they are not in the box', async ({ page }) => {
  const { guideId, documentId } = await uploadLumen(page);
  const imgReq = page.waitForResponse(new RegExp(`/api/documents/${documentId}/pages/1/image$`));
  await page.goto(`/g/${guideId}`);
  expect((await imgReq).ok()).toBeTruthy();
  const thumb = row(page, 'Side panel').getByTestId('part-thumb');
  await expect(thumb).toBeVisible();
  await expect(thumb.locator('img')).toHaveJSProperty('complete', true);
  await expect(row(page, 'Side panel')).toContainText('A');
  await expect(row(page, 'Side panel')).toContainText('x2');
  await expect(row(page, 'Phillips screwdriver')).toContainText('Not in the box - you need your own');
  await expect(row(page, 'Hex key')).not.toContainText('Not in the box');
});

test('Start needs the safety acknowledgement, confirms with unchecked items, and Continue resumes at the saved step', async ({ page }) => {
  const { guideId } = await uploadLumen(page);
  await page.goto(`/g/${guideId}`);
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(page.getByText('This job involves safety-critical work.')).toBeVisible();
  await expect(start).toBeDisabled();
  // The disabled Start says why, and a step in the outline cannot be used to get around the acknowledgement.
  await expect(page.getByTestId('start-helper').first()).toBeVisible();
  const outline = page.getByTestId('phases');
  await outline.locator('summary').first().click();
  await outline.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/g/${guideId}$`));
  await expect(page.getByLabel('I understand')).toBeFocused();
  await page.getByLabel('I understand').check();
  await expect(start).toBeEnabled();

  await start.click();
  const sheet = page.getByRole('dialog', { name: 'Start anyway?' });
  await expect(sheet).toContainText("You haven't checked 12 items. Start anyway?");
  await sheet.getByRole('button', { name: 'Back to checklist' }).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/g/${guideId}$`));

  await start.click();
  // Let the player's save of the current step finish before seeding, or its PATCH would land after the seed.
  const saved = page.waitForResponse((r) => r.url().endsWith('/progress') && r.request().method() === 'PATCH');
  await page.getByRole('dialog', { name: 'Start anyway?' }).getByRole('button', { name: 'Start anyway' }).click();
  await saved;
  await expect(page).toHaveURL(new RegExp(`/g/${guideId}/play\\?step=s1$`));

  await putProgress(page, guideId, { currentStepId: 's4', completedStepIds: ['s1', 's2', 's3'], checklist: {} });
  await page.goto(`/g/${guideId}`);
  const cont = page.getByRole('button', { name: 'Continue at step 4' });
  await expect(cont).toBeVisible();
  await cont.click();
  await expect(page).toHaveURL(new RegExp(`/g/${guideId}/play\\?step=s4$`));

  const all = Array.from({ length: 10 }, (_, i) => `s${i + 1}`);
  await putProgress(page, guideId, { currentStepId: 's10', completedStepIds: all, checklist: {} });
  await page.goto(`/g/${guideId}`);
  await expect(page.getByRole('button', { name: 'Review steps' })).toBeVisible();
});

test('the original-manual link, phase outline and unreadable-pages notice', async ({ page }) => {
  const { guideId } = await uploadLumen(page);
  const real = await (await page.request.get(`/api/guides/${guideId}`)).json();
  await page.route(`**/api/guides/${guideId}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ json: { ...real, guide: { ...real.guide, unreadablePages: [{ pageIndex: 6 }, { pageIndex: 7 }] } } });
  });
  await page.goto(`/g/${guideId}`);
  await expect(page.getByTestId('phases').locator('summary')).toHaveCount(3);
  const firstPhase = page.getByTestId('phases').locator('summary').first();
  await expect(firstPhase).toHaveAttribute('aria-expanded', 'false');
  await firstPhase.click();
  await expect(firstPhase).toHaveAttribute('aria-expanded', 'true');
  await firstPhase.click();
  await expect(page.getByTestId('phases')).toContainText('Get ready');
  await expect(page.getByTestId('phases')).toContainText('3 steps');
  await expect(page.getByText("We couldn't read pages 7 and 8.")).toBeVisible();
  await expect(page.getByRole('link', { name: 'View page 7' })).toHaveAttribute('href', `/g/${guideId}/play?panel=original&page=7`);
  await expect(page.getByRole('link', { name: /Start again with new photos/ })).toHaveAttribute('href', '/new?again=7,8');

  await page.getByRole('button', { name: 'More actions for this guide' }).click();
  await page.getByRole('menuitem', { name: 'Original manual' }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${guideId}/play\\?panel=original&page=1$`));
});

test('completion lists skipped steps with links back and parts still missing', async ({ page }) => {
  const { guideId } = await uploadLumen(page);
  const all = Array.from({ length: 10 }, (_, i) => `s${i + 1}`).filter((s) => s !== 's3' && s !== 's8');
  await putProgress(page, guideId, { currentStepId: 's10', completedStepIds: all, checklist: { 'cam-lock': 'missing', shelf: 'have' } });
  await page.goto(`/g/${guideId}/done`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not finished yet.');
  const skipped = page.getByTestId('skipped');
  await expect(skipped).toContainText("2 steps aren't marked done");
  await expect(skipped.getByRole('link')).toHaveCount(2);
  await expect(skipped.getByRole('link').first()).toHaveAttribute('href', `/g/${guideId}/play?step=s3`);
  await expect(page.getByTestId('missing')).toContainText('Cam lock');
  await expect(page.getByTestId('missing')).toContainText('Needed in step 4');
  await expect(page.getByText('Keep the original manual - it has the care, warranty and safety information.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Review the steps' })).toHaveAttribute('href', `/g/${guideId}/play?step=s1`);
  await expect(page.getByRole('link', { name: 'Open original manual' })).toHaveAttribute('href', `/g/${guideId}/play?panel=original&page=1`);

  await putProgress(page, guideId, { currentStepId: 's10', completedStepIds: Array.from({ length: 10 }, (_, i) => `s${i + 1}`), checklist: {} });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Finished.');
  await expect(page.getByText('You completed all 10 steps of Lumen 3-shelf bookcase.')).toBeVisible();
  await expect(page.getByTestId('skipped')).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to library' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('unknown guide shows the not-on-this-device message', async ({ page }) => {
  await page.goto('/g/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { name: "This guide isn't on this device." })).toBeVisible();
  await page.goto('/g/00000000-0000-4000-8000-000000000000/done');
  await expect(page.getByRole('heading', { name: "This guide isn't on this device." })).toBeVisible();
});

for (const [name, width, height] of [
  ['375', 375, 800],
  ['768', 768, 1024],
  ['1280', 1280, 900],
] as const) {
  test(`screenshots and layout at ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { guideId } = await uploadLumen(page);
    await putProgress(page, guideId, { currentStepId: 's2', completedStepIds: ['s1'], checklist: { shelf: 'have', 'cam-lock': 'missing' } });
    await page.goto(`/g/${guideId}`);
    await expect(page.getByTestId('prep-row')).toHaveCount(12);
    await expect(page.getByTestId('part-thumb').first().locator('img')).toHaveJSProperty('complete', true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOT}/overview-${name}.png`, animations: 'disabled', fullPage: width < 1024 });
    await expect(page.getByRole('button', { name: 'Continue at step 2' })).toBeVisible();

    await page.goto(`/g/${guideId}/done`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not finished yet.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOT}/done-${name}.png`, animations: 'disabled', fullPage: true });
  });
}
