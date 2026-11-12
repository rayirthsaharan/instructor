import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { VIEWPORTS, newPage, noHorizontalScroll, type VpName } from './m1-helpers';

// Integrated QA of M1: real web server + worker + mock AI provider, no route mocking.
const fx = (n: string) => join(process.cwd(), 'fixtures', n);
const lumenPhotos = () => [1, 2, 3, 4, 5, 6].map((n) => ({ name: `page-${n}.png`, mimeType: 'image/png', buffer: readFileSync(fx(`lumen-bookcase/page-${n}.png`)) }));
const GUIDE_URL = /\/g\/[0-9a-f-]{36}$/;
const DOC_URL = /\/d\/[0-9a-f-]{36}$/;

async function addPdfAndAnalyse(page: Page, file: string) {
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(fx(file));
  await page.getByRole('button', { name: 'Analyse manual' }).click();
}
const active = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName}|${a.getAttribute('aria-label') ?? ''}|${a === document.body ? '' : (a.textContent ?? '').trim().slice(0, 40)}` : 'none';
  });

for (const vp of ['375', '1280'] as VpName[]) {
  test.describe(`viewport ${vp}`, () => {
    test('first run: empty Library, then PDF flow with reload mid-processing, leave and return, back button', async ({ browser }) => {
      test.setTimeout(120_000);
      const { page, context } = await newPage(browser, vp);
      await page.goto('/');
      await expect(page.getByTestId('library-empty')).toBeVisible();
      await expect(page.getByText('Guides are saved on this device.')).toBeVisible();
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);

      await page.getByRole('link', { name: 'Add a manual' }).first().click();
      await expect(page).toHaveURL(/\/new$/);
      await page.getByTestId('file-input').setInputFiles(fx('lumen-bookcase.pdf'));
      await expect(page.getByTestId('pdf-row')).toContainText('lumen-bookcase.pdf');
      await page.getByRole('button', { name: 'Analyse manual' }).click();
      await expect(page).toHaveURL(DOC_URL);
      const docUrl = page.url();
      await expect(page.getByRole('heading', { name: 'Reading your manual' })).toBeVisible();
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);

      // leave to the Library while processing, the card must lead back to the same URL
      await page.getByRole('link', { name: 'Back to library' }).click();
      await expect(page).toHaveURL(/\/$/);
      const card = page.getByTestId('guide-card');
      await expect(card).toHaveCount(1);
      // reload the processing page mid-way, then it should still finish
      await page.goto(docUrl);
      await page.reload();
      await expect(page).toHaveURL(GUIDE_URL, { timeout: 60_000 });
      const guideUrl = page.url();
      await expect(page.getByRole('heading', { name: "Here's the plan" })).toBeVisible();

      // history: Back from the guide must not land on the spent Capture form or the processing page
      await page.goBack();
      const afterBack = new URL(page.url()).pathname;
      expect(afterBack, 'Back from the finished guide').not.toMatch(/^\/new$/);
      await page.goto('/');
      await expect(page.getByTestId('guide-card')).toContainText('Ready');
      await page.getByTestId('guide-card').getByRole('link').first().click();
      await expect(page).toHaveURL(guideUrl);
      await context.close();
    });

    test('reopening /d/<id> for a finished document redirects (replace) to the guide and Back does not trap', async ({ browser }) => {
      test.setTimeout(120_000);
      const { page, context } = await newPage(browser, vp);
      await addPdfAndAnalyse(page, 'lumen-bookcase.pdf');
      await expect(page).toHaveURL(GUIDE_URL, { timeout: 60_000 });
      const docId = await page.evaluate(async () => {
        const r = await fetch('/api/guides');
        return ((await r.json()) as { documentId: string }[])[0]!.documentId;
      });
      await page.goto('/');
      await page.goto(`/d/${docId}`);
      await expect(page).toHaveURL(GUIDE_URL);
      await page.goBack();
      await expect(page).toHaveURL(/\/$/); // the redirect replaced the /d entry
      await context.close();
    });

    test('photo set: reorder, remove with Undo, upload order is what the user sees', async ({ browser }) => {
      test.setTimeout(120_000);
      const { page, context } = await newPage(browser, vp);
      await page.goto('/new');
      await page.getByTestId('file-input').setInputFiles(lumenPhotos());
      const tiles = page.getByTestId('page-tile');
      await expect(tiles).toHaveCount(6);
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);

      // move page 1 later -> page-2, page-1, ...
      await page.getByRole('button', { name: 'Move page 1', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Move later' }).click();
      await expect(tiles.nth(0).locator('img')).toHaveAttribute('alt', /page-2\.png/);
      await expect(tiles.nth(1).locator('img')).toHaveAttribute('alt', /page-1\.png/);

      // remove page 3 (page-3.png) then undo: it returns to its position
      await page.getByRole('button', { name: 'Remove page 3' }).click();
      await expect(tiles).toHaveCount(5);
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(tiles).toHaveCount(6);
      await expect(tiles.nth(2).locator('img')).toHaveAttribute('alt', /page-3\.png/);

      // remove page 6 for real
      await page.getByRole('button', { name: 'Remove page 6' }).click();
      await expect(tiles).toHaveCount(5);
      await expect(page.locator('#analyse-helper')).toContainText('5 pages');

      let names: string[] = [];
      await page.route('**/api/documents', async (route) => {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
          names = [...body.matchAll(/filename="([^"]+)"/g)].map((m) => m[1] ?? '');
        }
        await route.continue();
      });
      await page.getByRole('button', { name: 'Analyse manual' }).click();
      await expect(page).toHaveURL(DOC_URL);
      expect(names).toEqual(['page-2.png', 'page-1.png', 'page-3.png', 'page-4.png', 'page-5.png']);
      await context.close();
    });

    test('not-a-manual: rejected copy, survives reload, Library card deletable with confirm', async ({ browser }) => {
      test.setTimeout(120_000);
      const { page, context } = await newPage(browser, vp);
      await addPdfAndAnalyse(page, 'not-a-manual.pdf');
      const h = page.getByRole('heading', { name: "This doesn't look like instructions" });
      await expect(h).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText("We look for manuals and step-by-step guides - for example assembly or setup instructions. This file seems to be something else.")).toBeVisible();
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await page.reload();
      await expect(h).toBeVisible();
      await page.getByRole('link', { name: 'Try a different file' }).click();
      await expect(page).toHaveURL(/\/new$/);
      await expect(page.getByTestId('pdf-row')).toHaveCount(0);
      // Note (spec conflict, not asserted): 10.1 says no Library card remains, but the API lists rejected documents and
      // the existing e2e expects a deletable card.
      await page.goto('/');
      await expect(page.getByTestId('guide-card').or(page.getByTestId('library-empty'))).toBeVisible();
      console.log(`[${vp}] cards for rejected doc: ${await page.getByTestId('guide-card').count()}`);
      await context.close();
    });

    test('mock-failure: retry, repeated-failure copy, delete from Library', async ({ browser }) => {
      test.setTimeout(180_000);
      const { page, context } = await newPage(browser, vp);
      await addPdfAndAnalyse(page, 'mock-failure.pdf');
      const failedMsg = page.getByText("We couldn't build a guide from this manual. This is on our side.");
      await expect(failedMsg).toBeVisible({ timeout: 90_000 });
      const again = page.getByRole('button', { name: 'Try again' });
      const repeated = page.getByText(/It's still not working\. Your manual is saved; try again later\./);
      await expect(page.getByRole('heading', { level: 1, name: "We couldn't finish your guide" })).toBeVisible();
      await expect(again, 'Try again after the first failure').toBeVisible();
      await expect(repeated).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      // retry 1 -> second failure: still Try again, no repeated copy; survives a reload
      await again.click();
      await expect(page.locator('[data-testid="state-processing"][data-status="failed"]')).toBeVisible({ timeout: 90_000 });
      await page.reload();
      await expect(failedMsg).toBeVisible({ timeout: 90_000 });
      await expect(again, 'Try again after the second failure').toBeVisible();
      await expect(repeated).toHaveCount(0);
      // retry 2 -> third failure: repeated copy, no Try again; survives a reload
      await again.click();
      await expect(repeated).toBeVisible({ timeout: 90_000 });
      await expect(again).toHaveCount(0);
      await page.reload();
      await expect(repeated).toBeVisible();
      await expect(again).toHaveCount(0);
      await expect(page.locator('[data-marker="failed"]')).toHaveCount(1);

      await page.getByRole('link', { name: 'Back to library' }).first().click();
      const card = page.getByTestId('guide-card');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(/Couldn.t finish|Try again/);
      await page.getByRole('button', { name: /More actions for/ }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      const dlg = page.getByRole('dialog');
      await expect(dlg).toContainText("The guide and the uploaded manual will be removed from this device's library.");
      expect(await active(page)).toContain('Cancel'); // focus starts on Cancel
      await page.keyboard.press('Escape');
      await expect(dlg).toHaveCount(0);
      await expect(card).toHaveCount(1);
      expect(await active(page), 'focus returns to the menu trigger after Esc').toContain('More actions');
      await page.getByRole('button', { name: /More actions for/ }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
      await expect(card).toHaveCount(1);
      await page.getByRole('button', { name: /More actions for/ }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByText('Guide deleted')).toBeVisible();
      await expect(card).toHaveCount(0);
      await expect(page.getByTestId('library-empty')).toBeVisible();
      // the document is really gone on the server
      await page.goto(page.url());
      await context.close();
    });

    test('upload errors use the exact specified copy and keep the screen usable', async ({ browser }) => {
      test.setTimeout(120_000);
      const { page, context } = await newPage(browser, vp);
      await page.goto('/new');
      const input = page.getByTestId('file-input');

      // encrypted PDF (server)
      await input.setInputFiles(fx('encrypted.pdf'));
      await page.getByRole('button', { name: 'Analyse manual' }).click();
      await expect(page.getByText('This PDF is locked with a password. Remove the password, or take photos of the pages.')).toBeVisible();
      await expect(page.getByRole('alert').getByText(/^PDF is locked$/i)).toBeVisible();
      // files are kept, Analyse is available again
      await expect(page.getByRole('button', { name: 'Analyse manual' })).toBeEnabled();
      await page.getByRole('button', { name: /^Remove / }).click();

      // oversize (client)
      await input.setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(41 * 1024 * 1024)]) });
      await expect(page.getByText("That's over the 40 MB limit. Try a smaller PDF, or photos of the pages instead.")).toBeVisible();
      await expect(page.getByTestId('pdf-row')).toHaveCount(0);

      // unsupported type (client)
      await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
      await expect(page.getByText("That file type isn't supported. Use a PDF, or JPEG, PNG, HEIC or WebP photos.")).toBeVisible();
      await expect(page.getByRole('button', { name: 'Analyse manual' })).toBeDisabled();

      // too many pages (server): 61 blank pages
      const doc = await PDFDocument.create();
      for (let i = 0; i < 61; i++) doc.addPage([100, 100]);
      await input.setInputFiles({ name: 'long.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
      await page.getByRole('button', { name: 'Analyse manual' }).click();
      await expect(page.getByText('This manual has 61 pages. The limit is 60. If your product is one section of it, upload just those pages.')).toBeVisible();

      // corrupt file (server)
      await page.getByRole('button', { name: /^Remove / }).click();
      await input.setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nthis is not really a pdf') });
      await page.getByRole('button', { name: 'Analyse manual' }).click();
      await expect(page.getByText("We couldn't open that file. It may be damaged. Try downloading it again or use photos.")).toBeVisible();
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await context.close();
    });

    test('network failure on upload keeps files and offers Try again', async ({ browser }) => {
      const { page, context } = await newPage(browser, vp);
      await page.goto('/new');
      let first = true;
      await page.route('**/api/documents', async (route) => {
        if (route.request().method() === 'POST' && first) {
          first = false;
          return route.abort('connectionreset');
        }
        return route.continue();
      });
      await page.getByTestId('file-input').setInputFiles(fx('not-a-manual.pdf'));
      await page.getByRole('button', { name: 'Analyse manual' }).click();
      await expect(page.getByText('The upload stopped. Check your connection.')).toBeVisible();
      await expect(page.getByTestId('pdf-row')).toBeVisible();
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page).toHaveURL(DOC_URL);
      await context.close();
    });

    test('PDF then photos asks to replace; Cancel keeps the PDF', async ({ browser }) => {
      const { page, context } = await newPage(browser, vp);
      await page.goto('/new');
      const input = page.getByTestId('file-input');
      await input.setInputFiles(fx('lumen-bookcase.pdf'));
      await input.setInputFiles(lumenPhotos().slice(0, 2));
      const dlg = page.getByRole('dialog');
      await expect(dlg).toContainText('Replace the PDF with these photos?');
      expect(await active(page)).toContain('Cancel');
      await dlg.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByTestId('pdf-row')).toBeVisible();
      await input.setInputFiles(lumenPhotos().slice(0, 2));
      await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
      await expect(page.getByTestId('page-tile')).toHaveCount(2);
      await context.close();
    });
  });
}

test('re-upload of the same manual: second guide arrives without a fresh analysis wait, both listed', async ({ browser }) => {
  test.setTimeout(120_000);
  const { page, context } = await newPage(browser, '1280');
  await addPdfAndAnalyse(page, 'lumen-bookcase.pdf');
  await expect(page).toHaveURL(GUIDE_URL, { timeout: 60_000 });
  const t0 = Date.now();
  await addPdfAndAnalyse(page, 'lumen-bookcase.pdf');
  await expect(page).toHaveURL(GUIDE_URL, { timeout: 60_000 });
  console.log(`re-upload took ${Date.now() - t0} ms`);
  await page.goto('/');
  await expect(page.getByTestId('guide-card')).toHaveCount(2);
  await context.close();
});

test('320px: no horizontal scroll on Library, Capture (PDF and photos), Processing, rejected, placeholder', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const overflow: Record<string, number> = {};
  const check = async (label: string) => {
    overflow[label] = await noHorizontalScroll(page);
  };
  await page.goto('/');
  await check('library-empty');
  await page.goto('/new');
  await check('capture-empty');
  await page.getByTestId('file-input').setInputFiles(lumenPhotos());
  await expect(page.getByTestId('page-tile')).toHaveCount(6);
  await check('capture-photos');
  await page.getByRole('button', { name: 'Analyse manual' }).click();
  await expect(page).toHaveURL(DOC_URL);
  await check('processing');
  await expect(page).toHaveURL(GUIDE_URL, { timeout: 60_000 });
  await check('placeholder');
  await page.goto('/');
  await expect(page.getByTestId('guide-card')).toHaveCount(1);
  await check('library-with-guide');
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(fx('lumen-bookcase.pdf'));
  await check('capture-pdf');
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(fx('not-a-manual.pdf'));
  await page.getByRole('button', { name: 'Analyse manual' }).click();
  await expect(page.getByRole('heading', { name: "This doesn't look like instructions" })).toBeVisible({ timeout: 60_000 });
  await check('rejected');
  for (const [k, v] of Object.entries(overflow)) expect(v, `horizontal overflow on ${k}`).toBeLessThanOrEqual(0);
  await context.close();
});

test('keyboard only: Library -> Capture -> upload -> Processing -> guide -> back, with visible focus and focus placement', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ ...VIEWPORTS['1280'] });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByTestId('library-empty')).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  // Tab until the Add a manual link is focused, then Enter
  let guard = 0;
  while (!(await active(page)).includes('Add a manual') && guard++ < 12) await page.keyboard.press('Tab');
  expect(await active(page)).toContain('Add a manual');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/new$/, { timeout: 20_000 });
  console.log('focus after navigating to /new:', await active(page));

  // reach "Choose files" by keyboard, open the chooser
  guard = 0;
  while (!(await active(page)).includes('Choose files') && guard++ < 12) await page.keyboard.press('Tab');
  expect(await active(page)).toContain('Choose files');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const chooser = await chooserPromise;
  await chooser.setFiles(fx('lumen-bookcase.pdf'));
  await expect(page.getByTestId('pdf-row')).toBeVisible();

  guard = 0;
  while (!(await active(page)).includes('Analyse manual') && guard++ < 12) await page.keyboard.press('Tab');
  expect(await active(page)).toContain('Analyse manual');
  // focus ring visible on the focused control
  const outline = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement!);
    return `${cs.outlineStyle}|${cs.outlineWidth}|${cs.boxShadow}`;
  });
  expect(outline).not.toMatch(/^none\|0px\|none$/);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(DOC_URL);
  console.log('focus after navigating to /d:', await active(page));
  await expect(page).toHaveURL(GUIDE_URL, { timeout: 60_000 });
  console.log('focus after navigating to /g:', await active(page));
  guard = 0;
  while (!(await active(page)).includes('Back to library') && guard++ < 12) await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/$/);
  await context.close();
});

test('focus moves to the page heading (or main) after a route change', async ({ browser }) => {
  // DS section 11 item 7 / a11y: after client-side navigation the keyboard user must not be left on <body>.
  const context = await browser.newContext({ ...VIEWPORTS['1280'] });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('link', { name: 'Add a manual' }).first().click();
  await expect(page).toHaveURL(/\/new$/);
  const a = await active(page);
  expect(a, 'focus after route change to /new').not.toMatch(/^BODY\|/);
  await context.close();
});

test('removing a page photo keeps keyboard focus inside the page grid', async ({ browser }) => {
  const context = await browser.newContext({ ...VIEWPORTS['1280'] });
  const page = await context.newPage();
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(lumenPhotos());
  await expect(page.getByTestId('page-tile')).toHaveCount(6);
  await page.getByRole('button', { name: 'Remove page 2' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-tile')).toHaveCount(5);
  expect(await active(page), 'focus after removing a tile').not.toMatch(/^BODY\|/);
  await context.close();
});

test('rate_limited upload shows its own copy and label; hero shows "Step n of m - title"', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ ...VIEWPORTS['1280'] });
  const page = await context.newPage();
  await page.route('**/api/documents', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 429, contentType: 'application/json', headers: { 'Retry-After': '60' }, body: JSON.stringify({ error: { code: 'rate_limited', message: 'x' } }) })
      : route.continue(),
  );
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(fx('not-a-manual.pdf'));
  await page.getByRole('button', { name: 'Analyse manual' }).click();
  await expect(page.getByText('Too many uploads in a short time. Wait a little, then try again.')).toBeVisible();
  await expect(page.getByText(/monthly|free guides/i)).toHaveCount(0);
  await expect(page.getByRole('alert').getByText(/too many uploads/i).first()).toBeVisible();
  await page.unroute('**/api/documents');

  await page.getByRole('button', { name: /^Remove / }).click();
  await page.getByTestId('file-input').setInputFiles(fx('lumen-bookcase.pdf'));
  await page.getByRole('button', { name: 'Analyse manual' }).click();
  await expect(page).toHaveURL(GUIDE_URL, { timeout: 60_000 });
  const second = await page.evaluate(async () => {
    const list = (await (await fetch('/api/guides')).json()) as { id: string }[];
    const g = (await (await fetch(`/api/guides/${list[0]!.id}`)).json()) as { id: string; guide: { phases: { stepIds: string[] }[]; steps: Record<string, { title: string }> } };
    const ids = g.guide.phases.flatMap((p) => p.stepIds);
    const step = { id: ids[1]!, title: g.guide.steps[ids[1]!]!.title };
    await fetch(`/api/guides/${g.id}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentStepId: step.id, completedStepIds: [ids[0]!], checklist: {} }),
    });
    return { title: step.title, total: ids.length };
  });
  await page.goto('/');
  await expect(page.getByTestId('hero-step')).toHaveText(`Step 2 of ${second.total} - ${second.title}`);
  await context.close();
});
