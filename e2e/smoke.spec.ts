import { test, expect } from '@playwright/test';

test('home page renders the Instructor heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Instructor' })).toBeVisible();
});
