import { expect, test } from '@playwright/test';
import { uploadLumen } from './m2-player-helpers';

test('a manual the app already knows opens its guide with the "We already know this manual" toast', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const first = await uploadLumen(context);
  const second = await uploadLumen(context);
  expect(second.documentId).not.toBe(first.documentId);
  expect(((await (await context.request.get(`/api/documents/${second.documentId}`)).json()) as { reused: boolean }).reused).toBe(true);
  expect(((await (await context.request.get(`/api/documents/${first.documentId}`)).json()) as { reused: boolean }).reused).toBe(false);

  const page = await context.newPage();
  await page.goto(`/d/${second.documentId}`);
  await expect(page).toHaveURL(new RegExp(`/g/${second.guideId}`));
  await expect(page.getByText('We already know this manual - your guide is ready.')).toBeVisible();

  // a first-time manual gets no such toast
  const other = await context.newPage();
  await other.goto(`/d/${first.documentId}`);
  await expect(other).toHaveURL(new RegExp(`/g/${first.guideId}`));
  await expect(other.getByText('We already know this manual')).toHaveCount(0);
  await context.close();
});
