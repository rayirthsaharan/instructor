import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Un-mocked: real API, real worker, mock AI provider (see playwright.config.ts).
const fx = (name: string) => join(process.cwd(), 'fixtures', name);

test('upload the Lumen bookcase PDF, follow Processing, land on the guide placeholder, see it in the Library', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Turn any manual into clear steps' })).toBeVisible();

  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(fx('lumen-bookcase.pdf'));
  await expect(page.getByTestId('pdf-row')).toContainText('lumen-bookcase.pdf');
  await page.getByRole('button', { name: 'Analyse manual' }).click();

  await expect(page).toHaveURL(/\/d\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Reading your manual' })).toBeVisible();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Your guide');
  await expect(page.getByText("Here's the plan")).toBeVisible();

  await page.getByRole('link', { name: 'Back to library' }).click();
  await expect(page.getByTestId('guide-card')).toHaveCount(1);
  await expect(page.getByTestId('guide-card')).toContainText('Ready');
});

test('the six page photos upload in order and the same flow completes', async ({ page }) => {
  await page.goto('/new');
  const photos = [1, 2, 3, 4, 5, 6].map((n) => {
    const name = `page-${n}.png`;
    return { name, mimeType: 'image/png', buffer: readFileSync(fx(`lumen-bookcase/${name}`)) };
  });
  await page.getByTestId('file-input').setInputFiles(photos);
  await expect(page.getByTestId('page-tile')).toHaveCount(6);
  await page.getByRole('button', { name: 'Analyse manual' }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/, { timeout: 60_000 });
});

test('a document that is not a manual ends in the rejected state and can be removed from the Library', async ({ page }) => {
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(fx('not-a-manual.pdf'));
  await page.getByRole('button', { name: 'Analyse manual' }).click();
  await expect(page.getByRole('heading', { name: "This doesn't look like instructions" })).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: "This doesn't look like instructions" })).toBeVisible();

  await page.getByRole('link', { name: 'Back to library' }).click();
  const card = page.getByTestId('guide-card');
  await expect(card).toHaveCount(1);
  await page.getByRole('button', { name: /More actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Guide deleted')).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('a failing analysis offers Try again first; the repeated-failure copy appears after two user retries', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(fx('mock-failure.pdf'));
  await page.getByRole('button', { name: 'Analyse manual' }).click();
  const again = page.getByRole('button', { name: 'Try again' });
  for (let retry = 0; retry < 2; retry++) {
    await expect(page.getByRole('heading', { name: "We couldn't finish your guide", level: 1 })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/still not working/)).toHaveCount(0);
    await again.click();
    await expect(again).toHaveCount(0);
  }
  await expect(page.getByText(/It's still not working\. Your manual is saved; try again later\./)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('link', { name: 'Back to library' })).toBeVisible();
  await expect(page.locator('[data-marker="failed"]')).toHaveCount(1);
});

test('an encrypted PDF is refused by the real API with the specified message', async ({ page }) => {
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(fx('encrypted.pdf'));
  await page.getByRole('button', { name: 'Analyse manual' }).click();
  await expect(page.getByText('This PDF is locked with a password. Remove the password, or take photos of the pages.')).toBeVisible();
});
