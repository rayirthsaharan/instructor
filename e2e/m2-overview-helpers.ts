import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SHOT = 'test-results/m2';

/** Uploads the Lumen fixture through the API in the page's session and waits for the guide. */
export async function uploadLumen(page: Page): Promise<{ guideId: string; documentId: string }> {
  const buffer = readFileSync(join(process.cwd(), 'fixtures', 'lumen-bookcase.pdf'));
  const up = await page.request.post('/api/documents', {
    multipart: { files: { name: 'lumen-bookcase.pdf', mimeType: 'application/pdf', buffer } },
  });
  expect(up.ok()).toBeTruthy();
  const { documentId } = (await up.json()) as { documentId: string };
  let guideId: string | null = null;
  await expect
    .poll(
      async () => {
        const d = (await (await page.request.get(`/api/documents/${documentId}`)).json()) as { guideId: string | null };
        guideId = d.guideId;
        return guideId;
      },
      { timeout: 60_000 },
    )
    .not.toBeNull();
  return { guideId: guideId!, documentId };
}

export async function putProgress(
  page: Page,
  guideId: string,
  body: { currentStepId: string | null; completedStepIds: string[]; checklist: Record<string, 'unchecked' | 'have' | 'missing'> },
) {
  const r = await page.request.put(`/api/guides/${guideId}/progress`, { data: body });
  expect(r.ok()).toBeTruthy();
}

export const row = (page: Page, name: string) => page.getByTestId('prep-row').filter({ hasText: name });
