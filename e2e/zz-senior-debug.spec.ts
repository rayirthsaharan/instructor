import { expect, test } from '@playwright/test';
import { putProgress, row, SHOT, uploadLumen } from './m2-overview-helpers';

// Un-mocked: real API, worker and mock provider (playwright.config.ts). Each test has its own session.

test('Start needs the safety acknowledgement, confirms with unchecked items, and Continue resumes at the saved step', async ({ page, context }) => {
  const { guideId } = await uploadLumen(page);
  const t0 = Date.now();
  context.on('request', (r) => { if (r.url().includes('/progress')) console.log('REQ', Date.now() - t0, r.method(), r.postData() ?? ''); });
  context.on('requestfinished', (r) => { if (r.url().includes('/progress')) console.log('FIN', Date.now() - t0, r.method()); });
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
  await page.getByRole('dialog', { name: 'Start anyway?' }).getByRole('button', { name: 'Start anyway' }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${guideId}/play\\?step=s1$`));

  console.log('SEED', Date.now() - t0);
  await putProgress(page, guideId, { currentStepId: 's4', completedStepIds: ['s1', 's2', 's3'], checklist: {} });
  console.log('SEEDED', Date.now() - t0);
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
