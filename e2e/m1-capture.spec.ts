import { expect, test } from '@playwright/test';
import { FakeApi, newPage, noHorizontalScroll, pdfFile, photoFile, SHOT, type VpName } from './m1-helpers';

const shots: VpName[] = ['375', '1280'];

for (const scheme of ['light', 'dark'] as const) {
  for (const vp of shots) {
    test(`capture ${scheme} @ ${vp}: empty, PDF, photos, error`, async ({ browser }) => {
      const { page, context } = await newPage(browser, vp, scheme);
      await new FakeApi().install(page);
      await page.goto('/new');

      await expect(page.getByRole('heading', { name: 'Add your manual', level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Analyse manual' })).toBeDisabled();
      await expect(page.getByText('Add a PDF or at least one page photo.')).toBeVisible();
      if (vp === '375') {
        await expect(page.getByRole('button', { name: 'Take photos' })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: 'Take photos' })).toHaveCount(0);
        await expect(page.getByText('or drop them here')).toBeVisible();
      }
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOT}/capture-empty-${vp}-${scheme}.png`, fullPage: true });

      // Error banner above the zone; the zone stays usable
      await page.getByTestId('file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
      await expect(page.getByText("That file type isn't supported. Use a PDF, or JPEG, PNG, HEIC or WebP photos.")).toBeVisible();
      await expect(page.getByTestId('dropzone')).toBeVisible();
      await page.screenshot({ path: `${SHOT}/capture-error-${vp}-${scheme}.png`, fullPage: true });

      // Photos
      await page.getByTestId('file-input').setInputFiles([1, 2, 3, 4, 5, 6, 7].map(photoFile));
      await expect(page.getByTestId('page-tile')).toHaveCount(7);
      await expect(page.getByText('7 pages')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Analyse manual' })).toBeEnabled();
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOT}/capture-photos-${vp}-${scheme}.png`, fullPage: true });

      // PDF
      await page.getByRole('button', { name: /Remove page/ }).first().waitFor();
      await context.close();
    });
  }
}

test('capture: PDF row, remove with Undo', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  await new FakeApi().install(page);
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles(pdfFile('cooler-manual.pdf', 3 * 1024 * 1024));
  const row = page.getByTestId('pdf-row');
  await expect(row).toContainText('cooler-manual.pdf');
  await expect(row).toContainText('3.0 MB');
  await expect(page.getByText('1 PDF - 3.0 MB')).toBeVisible();
  await page.screenshot({ path: `${SHOT}/capture-pdf-768-light.png`, fullPage: true });
  await page.getByRole('button', { name: 'Remove cooler-manual.pdf' }).click();
  await expect(page.getByTestId('dropzone')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('pdf-row')).toBeVisible();
  await context.close();
});

test('capture: reorder with the tile menu, remove with Undo, keyboard path', async ({ browser }) => {
  const { page, context } = await newPage(browser, '375');
  await new FakeApi().install(page);
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles([1, 2, 3].map(photoFile));
  const tiles = page.getByTestId('page-tile');
  await expect(tiles).toHaveCount(3);
  const names = () => tiles.evaluateAll((els) => els.map((e) => e.querySelector('img')?.getAttribute('alt') ?? ''));
  expect(await names()).toEqual(['Page 1 photo: page-1.png', 'Page 2 photo: page-2.png', 'Page 3 photo: page-3.png']);

  // Move page 3 earlier via keyboard
  const menuBtn = page.getByRole('button', { name: 'Move page 3', exact: true });
  await menuBtn.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Move later' })).toBeDisabled();
  await page.keyboard.press('Enter'); // first enabled item: Move earlier
  expect(await names()).toEqual(['Page 1 photo: page-1.png', 'Page 2 photo: page-3.png', 'Page 3 photo: page-2.png']);
  await expect(page.getByRole('status').filter({ hasText: 'Page 3 moved to position 2' })).toBeAttached();

  // First tile cannot move earlier
  await page.getByRole('button', { name: 'Move page 1', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Move earlier' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // Remove + Undo restores position
  await page.getByRole('button', { name: 'Remove page 2' }).click();
  await expect(tiles).toHaveCount(2);
  await expect(page.getByText('Page removed')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(tiles).toHaveCount(3);
  expect(await names()).toEqual(['Page 1 photo: page-1.png', 'Page 2 photo: page-3.png', 'Page 3 photo: page-2.png']);

  // "Add more pages" appends
  await page.getByRole('button', { name: 'Add more pages' }).click();
  await page.getByTestId('file-input').setInputFiles(photoFile(4));
  await expect(tiles).toHaveCount(4);
  await context.close();
});

test('capture: drag a tile to reorder', async ({ browser }) => {
  const { page, context } = await newPage(browser, '1280');
  await new FakeApi().install(page);
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles([1, 2, 3].map(photoFile));
  const tiles = page.getByTestId('page-tile');
  await tiles.nth(0).dragTo(tiles.nth(2));
  const names = await tiles.evaluateAll((els) => els.map((e) => e.querySelector('img')?.getAttribute('alt') ?? ''));
  expect(names).toEqual(['Page 1 photo: page-2.png', 'Page 2 photo: page-3.png', 'Page 3 photo: page-1.png']);
  await context.close();
});

test('capture: replacing photos with a PDF and a PDF with photos asks first', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  await new FakeApi().install(page);
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles([1, 2].map(photoFile));
  await page.getByTestId('file-input').setInputFiles(pdfFile());
  const dialog = page.getByRole('dialog', { name: 'Replace the photos with this PDF?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.getByTestId('file-input').setInputFiles(pdfFile());
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByTestId('pdf-row')).toBeVisible();
  await page.getByTestId('file-input').setInputFiles(photoFile(9));
  await expect(page.getByRole('dialog', { name: 'Replace the PDF with these photos?' })).toBeVisible();
  await page.screenshot({ path: `${SHOT}/capture-replace-768-light.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await context.close();
});

test('capture: client-side checks use the exact copy', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  await new FakeApi().install(page);
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(41 * 1024 * 1024) });
  await expect(page.getByText("That's over the 40 MB limit. Try a smaller PDF, or photos of the pages instead.")).toBeVisible();
  await expect(page.getByTestId('dropzone')).toBeVisible();

  await page.getByTestId('file-input').setInputFiles(Array.from({ length: 61 }, (_, i) => photoFile(i + 1)));
  await expect(page.getByText('This manual has 61 pages. The limit is 60. If your product is one section of it, upload just those pages.')).toBeVisible();
  await expect(page.getByTestId('page-tile')).toHaveCount(60);

  // HEIC: Chromium cannot decode it, so it is rejected with a clear message and not added.
  await page.reload();
  await page.getByTestId('file-input').setInputFiles(photoFile(1));
  await page.getByTestId('file-input').setInputFiles({ name: 'IMG_1.heic', mimeType: 'image/heic', buffer: Buffer.from('not really heic') });
  await expect(page.getByText(/couldn't convert that HEIC photo/)).toBeVisible();
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await context.close();
});

test('capture: the camera input asks for the rear camera', async ({ browser }) => {
  const { page, context } = await newPage(browser, '375');
  await new FakeApi().install(page);
  await page.goto('/new');
  await expect(page.getByTestId('camera-input')).toHaveAttribute('capture', 'environment');
  await expect(page.getByTestId('camera-input')).toHaveAttribute('accept', 'image/*');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Take photos' }).click();
  await (await chooser).setFiles(photoFile(1));
  await expect(page.getByTestId('page-tile')).toHaveCount(1);
  await context.close();
});

test('upload: success replaces history with /d/<id>, files sent in order', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.docs['doc42'] = { id: 'doc42', status: 'processing', stage: 'render', progress: 0.1, pageCount: 3, pagesRendered: 1, guideId: null, error: null, title: null };
  api.upload = { status: 201, body: { documentId: 'doc42' } };
  await api.install(page);
  await page.goto('/');
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles([1, 2, 3].map(photoFile));
  await page.getByRole('button', { name: 'Analyse manual' }).click();
  await expect(page).toHaveURL(/\/d\/doc42$/);
  expect(api.uploadedNames).toEqual(['page-1.png', 'page-2.png', 'page-3.png']);
  // Back skips the spent form
  await page.goBack();
  await expect(page).not.toHaveURL(/\/new$/);
  await context.close();
});

const serverErrors: Array<[string, number, string, string]> = [
  ['unsupported_type', 415, 'x', "That file type isn't supported. Use a PDF, or JPEG, PNG, HEIC or WebP photos."],
  ['too_large', 413, 'x', "That's over the 40 MB limit. Try a smaller PDF, or photos of the pages instead."],
  ['too_many_pages', 422, 'This PDF has 84 pages', 'This manual has 84 pages. The limit is 60. If your product is one section of it, upload just those pages.'],
  ['encrypted_pdf', 422, 'x', 'This PDF is locked with a password. Remove the password, or take photos of the pages.'],
  ['corrupt_file', 422, 'x', "We couldn't open that file. It may be damaged. Try downloading it again or use photos."],
  ['empty', 400, 'x', 'Add a PDF or at least one page photo.'],
  ['rate_limited', 429, 'x', 'Too many uploads right now. Wait a few minutes and try again.'],
  ['rate_limited', 503, 'x', 'Too many uploads right now. Wait a few minutes and try again.'],
  ['quota_exceeded', 429, 'x', "You've used this month's free guides."],
];
for (const [code, status, serverMessage, copy] of serverErrors) {
  test(`upload error ${code} (${status}) shows the specified message and keeps the form usable`, async ({ browser }) => {
    const { page, context } = await newPage(browser, '768');
    const api = new FakeApi();
    api.upload = { status, body: { error: { code, message: serverMessage } } };
    await api.install(page);
    await page.goto('/new');
    await page.getByTestId('file-input').setInputFiles(pdfFile());
    await page.getByRole('button', { name: 'Analyse manual' }).click();
    await expect(page.getByText(copy, { exact: true }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/new$/);
    await expect(page.getByTestId('pdf-row')).toBeVisible();
    if (code === 'quota_exceeded') await expect(page.getByRole('button', { name: 'Analyse manual' })).toBeDisabled();
    else await expect(page.getByRole('button', { name: 'Analyse manual' })).toBeEnabled();
    if (code === 'rate_limited') await expect(page.getByRole('main').getByRole('button', { name: 'Try again' })).toBeVisible();
    if (code === 'quota_exceeded') await page.screenshot({ path: `${SHOT}/capture-limit-768-light.png`, fullPage: true });
    await context.close();
  });
}

test('upload network failure: "The upload stopped" + Try again keeps the files and succeeds on retry', async ({ browser }) => {
  const { page, context } = await newPage(browser, '375');
  const api = new FakeApi();
  api.uploadAbort = true;
  api.docs['doc1'] = { id: 'doc1', status: 'queued', stage: null, progress: 0, pageCount: null, pagesRendered: null, guideId: null, error: null, title: null };
  await api.install(page);
  await page.goto('/new');
  await page.getByTestId('file-input').setInputFiles([1, 2].map(photoFile));
  await page.getByRole('button', { name: 'Analyse manual' }).click();
  await expect(page.getByText('The upload stopped. Check your connection.')).toBeVisible();
  await expect(page.getByTestId('page-tile')).toHaveCount(2);
  await page.screenshot({ path: `${SHOT}/capture-network-375-light.png`, fullPage: true });
  api.uploadAbort = false;
  await page.getByRole('main').getByRole('button', { name: 'Try again' }).click();
  await expect(page).toHaveURL(/\/d\/doc1$/);
  await context.close();
});

test('the photo tip is shown once on desktop and once on mobile', async ({ browser }) => {
  for (const vp of ['375', '1280'] as const) {
    const { page, context } = await newPage(browser, vp);
    await new FakeApi().install(page);
    await page.goto('/new');
    await expect(page.getByText('Photograph each page flat, in good light, one page per photo.').locator('visible=true')).toHaveCount(1);
    await context.close();
  }
});

test('"Start again" banner from ?again=', async ({ browser }) => {
  const { page, context } = await newPage(browser, '375');
  await new FakeApi().install(page);
  await page.goto('/new?again=7');
  await expect(page.getByText('Add every page again, including page 7. Your current guide stays in your library.')).toBeVisible();
  await page.goto('/new?again=12,7,8,x');
  await expect(page.getByText('Add every page again, including pages 7, 8 and 12. Your current guide stays in your library.')).toBeVisible();
  await page.goto('/new');
  await expect(page.getByText(/Add every page again/)).toHaveCount(0);
  await context.close();
});
