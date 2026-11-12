import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import {
  getProgress,
  openPlayer,
  patchGuide,
  primary,
  putProgress,
  query,
  stepTitle,
  swipe,
  uploadLumen,
  visual,
  visualReady,
  VIEWPORTS,
  type ProgressBody,
  type VpName,
} from './m2-player-helpers';

// Real app, real worker, mock AI provider: the Lumen bookcase guide (10 steps, 3 phases).
let guideId = '';
let state: Awaited<ReturnType<BrowserContext['storageState']>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  ({ guideId } = await uploadLumen(ctx));
  state = await ctx.storageState();
  await ctx.close();
});

async function start(browser: Browser, vp: VpName = '375', progress: Partial<ProgressBody> = {}, scheme: 'light' | 'dark' = 'light') {
  const context = await browser.newContext({ ...VIEWPORTS[vp], storageState: state, colorScheme: scheme });
  await putProgress(context, guideId, progress);
  const page = await context.newPage();
  return { context, page };
}

const savedProgress = (context: BrowserContext) => () => getProgress(context, guideId);
const done = (...ids: string[]) => ({ completedStepIds: ids });
const S = (n: number) => `s${n}`;

test.describe('navigation and completion', () => {
  test('opens at step 1, only the primary button completes, progress is saved, Undo returns', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId);
    await expect(stepTitle(page)).toContainText('Check the parts');
    await expect(page.getByTestId('step-counter')).toContainText('Step 1 of 10');
    await expect(page).toHaveURL(/step=s1/);
    await expect(page.getByTestId('back')).toBeDisabled();
    await expect(primary(page)).toHaveText('Done - next step');

    await primary(page).click();
    await expect(page).toHaveURL(/step=s2/);
    await expect(stepTitle(page)).toContainText('Insert the dowels');
    await expect(page.getByRole('status').filter({ hasText: 'Step 1 done' })).toBeVisible();
    await expect.poll(savedProgress(context)).toMatchObject({ completedStepIds: ['s1'], currentStepId: 's2' });
    // focus moved to the new step title (USER_FLOWS 6.4)
    await expect(stepTitle(page)).toBeFocused();

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page).toHaveURL(/step=s1/);
    await expect.poll(savedProgress(context)).toMatchObject({ completedStepIds: [], currentStepId: 's1' });
    await expect(page.getByTestId('done-tag')).toHaveCount(0);
    await context.close();
  });

  test('arrow keys, Back button and swipes only navigate; nothing is completed', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s3');
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/step=s4/);
    await page.keyboard.press('PageDown');
    await expect(page).toHaveURL(/step=s5/);
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(/step=s4/);
    await page.getByTestId('back').click();
    await expect(page).toHaveURL(/step=s3/);

    // swipe left on the text panel = next; right = previous
    const panel = await page.getByTestId('text-panel').boundingBox();
    const y = panel!.y + panel!.height / 2;
    await swipe(page, { x: 300, y }, { x: 100, y });
    await expect(page).toHaveURL(/step=s4/);
    await swipe(page, { x: 100, y }, { x: 300, y });
    await expect(page).toHaveURL(/step=s3/);
    // a mostly vertical drag is a scroll, not a swipe
    await swipe(page, { x: 200, y: y + 60 }, { x: 150, y: y - 60 });
    await expect(page).toHaveURL(/step=s3/);

    await page.waitForTimeout(900); // longer than the save debounce
    expect((await getProgress(context, guideId)).completedStepIds).toEqual([]);
    await context.close();
  });

  test('swiping the picture at 1x navigates; a zoomed picture pans instead', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s3');
    await visualReady(page);
    const box = (await visual(page).boundingBox())!;
    const y = box.y + box.height / 2;
    await swipe(page, { x: box.x + box.width - 60, y }, { x: box.x + 60, y });
    await expect(page).toHaveURL(/step=s4/);

    await visualReady(page);
    await page.getByTestId('zoom-in').click();
    await expect(visual(page)).toHaveAttribute('data-zoom', '1.50');
    await swipe(page, { x: box.x + box.width - 60, y }, { x: box.x + 60, y });
    await expect(page).toHaveURL(/step=s4/);
    await context.close();
  });

  test('last step finishes to the completion screen and everything is saved', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { ...done('s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'), currentStepId: 's10' });
    await openPlayer(page, guideId, '?step=s10');
    await expect(primary(page)).toHaveText('Done - finish');
    await primary(page).click();
    await expect(page).toHaveURL(new RegExp(`/g/${guideId}/done$`));
    await expect.poll(async () => (await getProgress(context, guideId)).completedStepIds.length).toBe(10);
    await context.close();
  });

  test('a finished step reads "Next step" and shows a Done tag; the menu can mark it not done', async ({ browser }) => {
    const { context, page } = await start(browser, '375', done('s2'));
    await openPlayer(page, guideId, '?step=s2');
    await expect(primary(page)).toHaveText('Next step');
    await expect(page.getByTestId('done-tag')).toBeVisible();
    await page.getByRole('button', { name: 'More options for this guide' }).click();
    await page.getByRole('menuitem', { name: 'Mark as not done' }).click();
    await expect(page.getByTestId('done-tag')).toHaveCount(0);
    await expect(primary(page)).toHaveText('Done - next step');
    await expect.poll(savedProgress(context)).toMatchObject({ completedStepIds: [] });
    await context.close();
  });

  test('a fully finished guide opens at step 1 in review mode', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { ...done(...Array.from({ length: 10 }, (_, i) => S(i + 1))), currentStepId: 's10' });
    await openPlayer(page, guideId);
    await expect(stepTitle(page)).toContainText('Check the parts');
    await expect(page.getByTestId('finished-tag')).toBeVisible();
    await expect(primary(page)).toHaveText('Next step');
    await context.close();
  });
});

test.describe('resume and URL state', () => {
  test('no ?step resumes at the saved step with a toast; a reload stays on that step', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { ...done('s1', 's2', 's3', 's4'), currentStepId: 's5' });
    await page.goto(`/g/${guideId}/play`);
    await expect(stepTitle(page)).toContainText('Join the shelves');
    await expect(page.getByRole('status').filter({ hasText: 'Picking up at step 5' })).toBeVisible();
    await expect(page).toHaveURL(/step=s5/);
    await page.reload();
    await expect(stepTitle(page)).toContainText('Join the shelves');
    await context.close();
  });

  test('the URL wins over saved progress; step changes survive a reload', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { currentStepId: 's5' });
    await openPlayer(page, guideId, '?step=s2');
    await expect(stepTitle(page)).toContainText('Insert the dowels');
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/step=s3/);
    await expect.poll(savedProgress(context)).toMatchObject({ currentStepId: 's3' });
    await page.reload();
    await expect(stepTitle(page)).toContainText('Fit the cam bolts');
    await context.close();
  });

  test('an unknown ?step falls back to where the user left off, with a toast', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { currentStepId: 's4' });
    await page.goto(`/g/${guideId}/play?step=nope`);
    await expect(stepTitle(page)).toContainText('Press in the cam locks');
    await expect(page.getByRole('status').filter({ hasText: "That step isn't in this guide - showing where you left off." })).toBeVisible();
    await expect(page).toHaveURL(/step=s4/);
    await context.close();
  });

  test('an unknown guide shows the not-found state', async ({ browser }) => {
    const { context, page } = await start(browser);
    await page.goto('/g/00000000-0000-4000-8000-000000000000/play');
    await expect(page.getByRole('heading', { name: "This guide isn't on this device." })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to library' })).toBeVisible();
    await context.close();
  });
});

test.describe('overlays and Back', () => {
  test('Steps sheet: grouped by phase, current row marked, Back closes it, a row opens its step', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { ...done('s1', 's2'), currentStepId: 's3' });
    await openPlayer(page, guideId, '?step=s3');
    await page.getByTestId('steps-button').click();
    const sheet = page.getByRole('dialog', { name: 'Steps' });
    await expect(sheet).toBeVisible();
    expect(query(page).get('panel')).toBe('steps');
    await expect(sheet.getByRole('heading', { level: 3 })).toHaveCount(3);
    await expect(sheet.getByRole('heading', { level: 3 }).first()).toContainText('2/3');
    await expect(sheet.locator('[data-rail-row]')).toHaveCount(10);
    await expect(sheet.locator('[aria-current="step"]')).toContainText('Fit the cam bolts');
    await expect(sheet.locator('[data-step="s1"]')).toHaveAttribute('data-done', 'true');
    await expect(sheet.locator('[data-step="s7"]')).toContainText("Can't be undone");
    await expect(sheet.locator('[data-step="s8"]')).toContainText('Double-check');

    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(stepTitle(page)).toContainText('Fit the cam bolts');

    await page.getByTestId('steps-button').click();
    await sheet.locator('[data-step="s6"]').click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/step=s6/);
    expect(query(page).get('panel')).toBeNull();
    await expect(stepTitle(page)).toContainText('Add the second side');
    // Esc also closes a sheet
    await page.getByTestId('steps-button').click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await context.close();
  });

  test('Ask opens the assistant sheet; Back closes it', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s2');
    await page.getByTestId('ask-button').click();
    const sheet = page.getByRole('dialog', { name: 'Ask about this step' });
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    expect(query(page).get('panel')).toBe('ask');
    await page.goBack();
    await expect(sheet).toBeHidden();
    await context.close();
  });

  test('Original viewer: opens at the step page with the region bracketed, clears brackets on page change, returns to the same step and zoom', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    await page.getByTestId('zoom-in').click();
    await expect(visual(page)).toHaveAttribute('data-zoom', '1.50');

    await page.getByTestId('original-page').click();
    const viewer = page.getByTestId('original-viewer');
    await expect(viewer).toBeVisible();
    expect(query(page).get('panel')).toBe('original');
    expect(query(page).get('page')).toBe('3');
    await expect(page.getByTestId('viewer-page')).toHaveText('Page 3 of 6');
    await expect(viewer.getByTestId('mark')).toHaveCount(2);
    await expect(viewer.getByTestId('viewer-visual')).toHaveAttribute('data-zoom', '1.00'); // starts fitted to the whole page

    await viewer.getByTestId('viewer-next').click();
    await expect(page.getByTestId('viewer-page')).toHaveText('Page 4 of 6');
    await expect(page).toHaveURL(/page=4/);
    await expect(viewer.getByTestId('mark')).toHaveCount(0);
    await expect(viewer.getByTestId('viewer-marks')).toHaveCount(0);

    await page.goBack();
    await expect(viewer).toBeHidden();
    await expect(stepTitle(page)).toContainText('Insert the dowels');
    await expect(visual(page)).toHaveAttribute('data-zoom', '1.50');
    await context.close();
  });

  test('Original viewer: Esc and the close button return to the step; keyboard opens it; arrows change pages', async ({ browser }) => {
    const { context, page } = await start(browser, '768');
    await openPlayer(page, guideId, '?step=s2');
    await page.keyboard.press('o');
    const viewer = page.getByTestId('original-viewer');
    await expect(viewer).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('viewer-page')).toHaveText('Page 4 of 6');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('viewer-page')).toHaveText('Page 2 of 6');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(stepTitle(page)).toContainText('Insert the dowels');

    await page.getByTestId('original-page').click();
    await page.getByRole('button', { name: 'Back to step 2' }).click();
    await expect(viewer).toBeHidden();
    await context.close();
  });

  test('Original viewer deep link (from the Overview) opens at that page with no brackets', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    await page.goto(`/g/${guideId}/play?panel=original&page=5`);
    await expect(page.getByTestId('viewer-page')).toHaveText('Page 5 of 6');
    await expect(page.getByTestId('original-viewer').getByTestId('mark')).toHaveCount(0);
    await page.getByRole('button', { name: /Back to step/ }).click();
    await expect(page.getByTestId('original-viewer')).toBeHidden();
    expect(query(page).get('panel')).toBeNull();
    await expect(stepTitle(page)).toBeVisible();
    await context.close();
  });

  test('"Show original page" under the step opens the first source page', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    await openPlayer(page, guideId, '?step=s5');
    await page.getByTestId('show-original').click();
    await expect(page.getByTestId('viewer-page')).toHaveText('Page 4 of 6');
    await context.close();
  });
});

test.describe('source visual', () => {
  test('page image is shown with meaningful alt text, brackets, dim wash and numbered callouts', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    await expect(visual(page).locator('img')).toHaveAttribute('alt', 'Manual page 3, area for step 2: Insert the dowels');
    await expect(visual(page).locator('img')).toHaveAttribute('src', /\/api\/documents\/[0-9a-f-]+\/pages\/2\/image/);
    await expect(visual(page).getByTestId('mark')).toHaveCount(2);
    await expect(visual(page).getByTestId('dim-wash')).toHaveCount(1);
    await expect(visual(page).getByTestId('callout')).toHaveCount(2);
    await expect(visual(page).getByRole('button', { name: /Marked area 1: Dowels/ })).toBeVisible();
    await expect(visual(page).getByRole('list', { name: 'Marked areas' }).getByRole('listitem')).toHaveCount(2);
    await expect(visual(page).getByTestId('page-tag')).toHaveText('p. 3');
    await context.close();
  });

  test('Marks toggle hides every overlay and the image stays', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    const toggle = page.getByTestId('marks-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(visual(page)).toHaveAttribute('data-marks', 'off');
    await expect(visual(page).getByTestId('mark')).toHaveCount(0);
    await expect(visual(page).getByTestId('dim-wash')).toHaveCount(0);
    await expect(visual(page).getByTestId('callout')).toHaveCount(0);
    await expect(page.getByTestId('marks-off-tag')).toHaveText('Marks off');
    await expect(visual(page).locator('img')).toBeVisible();
    // keyboard equivalent: M
    await visual(page).focus();
    await page.keyboard.press('m');
    await expect(visual(page)).toHaveAttribute('data-marks', 'on');
    await expect(visual(page).getByTestId('mark')).toHaveCount(2);
    await context.close();
  });

  test('zoom: buttons step x1.5 up to 5x, Fit resets, keyboard + - 0, Ctrl+wheel, drag pans when zoomed', async ({ browser }) => {
    const { context, page } = await start(browser, '768');
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    const v = visual(page);
    await expect(v).toHaveAttribute('data-zoom', '1.00');
    await expect(page.getByTestId('zoom-out')).toBeDisabled();
    await page.getByTestId('zoom-in').click();
    await expect(v).toHaveAttribute('data-zoom', '1.50');
    await page.getByTestId('zoom-in').click();
    await expect(v).toHaveAttribute('data-zoom', '2.25');
    await page.getByTestId('zoom-out').click();
    await expect(v).toHaveAttribute('data-zoom', '1.50');
    await page.getByTestId('zoom-reset').click();
    await expect(v).toHaveAttribute('data-zoom', '1.00');

    for (let i = 0; i < 10; i++) if (await page.getByTestId('zoom-in').isEnabled()) await page.getByTestId('zoom-in').click();
    await expect(v).toHaveAttribute('data-zoom', '5.00');
    await expect(page.getByTestId('zoom-in')).toBeDisabled();
    await page.getByTestId('zoom-reset').click();

    await v.focus();
    await page.keyboard.press('+');
    await expect(v).toHaveAttribute('data-zoom', '1.50');
    // arrows pan the zoomed picture and do not change the step
    const img = v.locator('img');
    const before = await img.evaluate((e) => (e as HTMLElement).style.transform);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight'); // pans (or stays put) while the picture is zoomed; never changes the step
    await expect(page).toHaveURL(/step=s2/);
    await expect.poll(() => img.evaluate((e) => (e as HTMLElement).style.transform)).not.toBe(before);
    await page.keyboard.press('-');
    await expect(v).toHaveAttribute('data-zoom', '1.00');
    await page.keyboard.press('+');
    await page.keyboard.press('0');
    await expect(v).toHaveAttribute('data-zoom', '1.00');

    const box = (await v.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await expect.poll(async () => Number(await v.getAttribute('data-zoom'))).toBeGreaterThan(1.5);
    await page.getByTestId('zoom-reset').click();

    // drag pans a zoomed picture, bounded to the page
    await page.getByTestId('zoom-in').click();
    await page.getByTestId('zoom-in').click();
    const t0 = await img.evaluate((e) => (e as HTMLElement).style.transform);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => img.evaluate((e) => (e as HTMLElement).style.transform)).not.toBe(t0);
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(await img.evaluate((e) => (e as HTMLElement).style.transform))!;
    expect(Number(m[1])).toBeLessThanOrEqual(0.5);
    expect(Number(m[2])).toBeLessThanOrEqual(0.5);
    // a double click returns to fit
    await v.dblclick({ position: { x: 100, y: 100 } });
    await expect(v).toHaveAttribute('data-zoom', '1.00');
    await context.close();
  });

  test('zoom is reset when the step changes', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    await page.getByTestId('zoom-in').click();
    await expect(visual(page)).toHaveAttribute('data-zoom', '1.50');
    await page.getByTestId('instruction').click(); // focus leaves the zoomed picture, so arrows navigate
    await page.keyboard.press('ArrowRight');
    await expect(stepTitle(page)).toContainText('Fit the cam bolts');
    await expect(visual(page)).toHaveAttribute('data-zoom', '1.00');
    await context.close();
  });

  test('multi-page step: pager 1 / 2 over the step sources', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s1');
    await visualReady(page);
    await expect(page.getByTestId('pager-count')).toHaveText('1 / 2');
    await expect(page.getByTestId('page-tag')).toHaveText('p. 1');
    await expect(page.getByTestId('pager-prev')).toBeDisabled();
    await page.getByTestId('pager-next').click();
    await expect(page.getByTestId('pager-count')).toHaveText('2 / 2');
    await expect(page.getByTestId('page-tag')).toHaveText('p. 2');
    await expect(visual(page).locator('img')).toHaveAttribute('src', /pages\/1\/image/);
    await expect(visual(page).locator('img')).toHaveAttribute('alt', 'Manual page 2, area for step 1: Check the parts');
    await expect(page.getByTestId('pager-next')).toBeDisabled();
    await context.close();
  });

  test('a highlight is drawn on its own page; selecting its part chip switches the pager', async ({ browser }) => {
    const { context, page } = await start(browser);
    await patchGuide(page, guideId, (g) => {
      const s2 = g.steps.s2;
      s2.highlights = [
        { source: { pageIndex: 2, panelId: 'p3-a', regionFallback: false, region: { x: 0.14, y: 0.208, w: 0.558, h: 0.175 } }, partId: 'side-panel', label: 'Side panel' },
        { source: { pageIndex: 4, regionFallback: false, region: { x: 0.2, y: 0.3, w: 0.4, h: 0.2 } }, partId: 'dowel', label: 'Dowels' },
      ];
    });
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    await expect(page.getByTestId('pager-count')).toHaveText('1 / 2');
    await expect(visual(page).getByTestId('mark')).toHaveCount(1); // only the side panel is on page 3
    await page.getByRole('button', { name: /Wooden dowel/ }).click();
    await expect(page.getByTestId('pager-count')).toHaveText('2 / 2');
    await expect(visual(page)).toHaveAttribute('data-page', '4');
    await expect(visual(page).getByTestId('mark')).toHaveCount(1);
    await expect(visual(page).getByTestId('callout')).toHaveAttribute('aria-pressed', 'true');
    await context.close();
  });

  test('part chip and callout select each other; a second tap opens the Part sheet', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    const chip = page.getByRole('button', { name: /Wooden dowel/ });
    await expect(chip).toContainText('x8');
    await expect(chip).toContainText('G');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(visual(page).getByRole('button', { name: /Marked area 1: Dowels/ })).toHaveAttribute('aria-pressed', 'true');
    // tapping the other callout moves the selection to its part
    await visual(page).getByRole('button', { name: /Marked area 2: Side panel/ }).click();
    await expect(page.getByRole('button', { name: /Side panel/ }).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    // second tap on a selected chip opens the part sheet
    const sidePanelChip = page.getByTestId('step-chips').getByRole('button', { name: /Side panel/ });
    await sidePanelChip.click();
    const sheet = page.getByRole('dialog', { name: 'Side panel' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Label in the manual');
    await sheet.getByRole('button', { name: 'Show in manual' }).click();
    await expect(page.getByTestId('original-viewer')).toBeVisible();
    await context.close();
  });

  test('image failure shows an error state with Try again, and a note under the instruction', async ({ browser }) => {
    const { context, page } = await start(browser);
    await page.route('**/api/documents/*/pages/*/image', (r) => r.abort());
    await openPlayer(page, guideId, '?step=s2');
    await expect(visual(page)).toHaveAttribute('data-load', 'error');
    await expect(visual(page)).toContainText("Couldn't load this page");
    await expect(page.getByText("The picture didn't load. You can still open the original manual.")).toBeVisible();
    await expect(primary(page)).toBeEnabled(); // the step is still usable
    await page.unroute('**/api/documents/*/pages/*/image');
    // The error block can re-render once while the aborted request settles: retry the click until the image loads.
    await expect(async () => {
      await visual(page).getByRole('button', { name: 'Try again' }).click({ timeout: 2000 });
      await expect(visual(page)).toHaveAttribute('data-load', 'loaded', { timeout: 3000 });
    }).toPass({ timeout: 15_000 });
    await visualReady(page);
    await context.close();
  });

  test('the loading state is a skeleton with no spinner', async ({ browser }) => {
    const { context, page } = await start(browser);
    await page.route('**/api/documents/*/pages/*/image', async (r) => {
      await new Promise((res) => setTimeout(res, 1500));
      await r.continue();
    });
    await page.goto(`/g/${guideId}/play?step=s2`);
    await expect(page.getByTestId('visual-skeleton')).toBeVisible();
    await expect(stepTitle(page)).toBeVisible(); // text is live while the picture loads
    await expect(primary(page)).toBeEnabled();
    await expect(page.getByTestId('visual-skeleton')).toBeHidden({ timeout: 10_000 });
    await context.close();
  });

  test('approximate region (regionFallback) draws dashed brackets and the "Approximate area" tag', async ({ browser }) => {
    const { context, page } = await start(browser);
    await patchGuide(page, guideId, (g) => {
      g.steps.s2.sources = [{ pageIndex: 2, regionFallback: true, region: { x: 0.12, y: 0.18, w: 0.6, h: 0.3 } }];
    });
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    await expect(visual(page)).toHaveAttribute('data-tag', 'approximate');
    await expect(page.getByTestId('visual-tag')).toHaveText('Approximate area');
    await expect(visual(page).locator('[data-mark="s0"]')).toHaveAttribute('data-dashed', 'true');
    await expect(visual(page).locator('[data-mark="h0"]')).toHaveAttribute('data-dashed', 'false');
    await context.close();
  });

  test('no usable region: the whole page is shown and tagged', async ({ browser }) => {
    const { context, page } = await start(browser);
    await patchGuide(page, guideId, (g) => {
      g.steps.s3.sources = [{ pageIndex: 2, panelId: 'p3-b', regionFallback: false }];
    });
    await openPlayer(page, guideId, '?step=s3');
    await visualReady(page);
    await expect(page.getByTestId('visual-tag')).toHaveText('Whole page shown');
    await context.close();
  });

  test('the page image is never recoloured, in dark mode too', async ({ browser }) => {
    const { context, page } = await start(browser, '375', {}, 'dark');
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    await expect.poll(() => visual(page).locator('img').evaluate((e) => getComputedStyle(e).opacity)).toBe('1'); // fade-in finished
    const style = await visual(page).locator('img').evaluate((e) => {
      const c = getComputedStyle(e);
      return { filter: c.filter, blend: c.mixBlendMode, bg: c.backgroundColor, opacity: c.opacity };
    });
    expect(style).toEqual({ filter: 'none', blend: 'normal', bg: 'rgb(255, 255, 255)', opacity: '1' });
    const ancestors = await visual(page).evaluate((e) => {
      const out: string[] = [];
      for (let n: Element | null = e; n; n = n.parentElement) out.push(getComputedStyle(n).filter);
      return out;
    });
    expect(ancestors.every((f) => f === 'none')).toBe(true);
    await context.close();
  });

  test('reduced motion: no zoom transition on the picture', async ({ browser }) => {
    const context = await browser.newContext({ ...VIEWPORTS['375'], storageState: state, reducedMotion: 'reduce' });
    await putProgress(context, guideId);
    const page = await context.newPage();
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    await page.getByTestId('zoom-in').click();
    const t = await visual(page).locator('img').evaluate((e) => getComputedStyle(e).transitionProperty);
    expect(t).toBe('opacity');
    await context.close();
  });
});

test.describe('step content', () => {
  test('provenance: the manual quote is verbatim, Instructor guidance is labelled, interpretation is tagged', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s1');
    const content = page.getByTestId('step-content');
    await expect(content.locator('blockquote')).toContainText('FROM YOUR MANUAL'.toLowerCase().replace(/^./, 'F'));
    await expect(content.locator('blockquote p')).toHaveText('Check that all parts are present before you begin.');
    const why = content.getByRole('button', { name: 'Why this matters' });
    await expect(why).toHaveAttribute('aria-expanded', 'false');
    await why.click();
    await expect(why).toHaveAttribute('aria-expanded', 'true');
    await expect(content.getByText("Instructor's explanation - not the manual's wording.")).toBeVisible();
    await expect(content.getByRole('button', { name: 'Common mistake' })).toHaveCount(0); // no data, no row
    await expect(content.getByRole('button', { name: 'Explain it more simply' })).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight'); // s4: read from the picture
    await expect(stepTitle(page)).toContainText('Press in the cam locks');
    await expect(content.getByText('Read from the picture - the manual has no words here')).toBeVisible();
    await expect(content.locator('[data-kind="unsure"]')).toHaveCount(0); // medium confidence: no marker
    await expect(visual(page)).toHaveAttribute('data-tag', ''); // cropped to its panel
    await context.close();
  });

  test('warnings are always on screen with the manual wording; severity warning before caution', async ({ browser }) => {
    const { context, page } = await start(browser);
    await patchGuide(page, guideId, (g) => {
      g.steps.s5.warnings = [
        { text: 'Keep fingers clear.', severity: 'caution', sourceQuote: 'Keep fingers clear.', interpretedFromDiagram: false },
        { text: 'Do not over-tighten.', severity: 'warning', sourceQuote: 'DO NOT OVER-TIGHTEN THE BOLTS', interpretedFromDiagram: false },
        { text: 'A hot surface symbol is shown.', severity: 'caution', interpretedFromDiagram: true },
      ];
    });
    await openPlayer(page, guideId, '?step=s5');
    const banners = page.getByTestId('step-content').locator('[data-kind="warning"], [data-kind="caution"]');
    await expect(banners).toHaveCount(3);
    await expect(banners.nth(0)).toContainText('Do not over-tighten.');
    await expect(banners.nth(0)).toContainText('DO NOT OVER-TIGHTEN THE BOLTS'); // differs: full quote, expanded
    await expect(banners.nth(1)).toContainText('Keep fingers clear.');
    await expect(banners.nth(1)).toContainText('From your manual'); // equal: source line
    await expect(banners.nth(2)).toContainText('Read from the picture');
    await banners.nth(1).getByRole('button', { name: /Open manual page/ }).click();
    await expect(page.getByTestId('original-viewer')).toBeVisible();
    await context.close();
  });

  test('irreversible step: notice on the step before, banner first, "I checked - done"', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s6');
    await expect(page.getByTestId('next-irreversible')).toHaveText("Next step can't be undone");
    await expect(primary(page)).toHaveText('Done - next step');
    await primary(page).click();
    await expect(stepTitle(page)).toContainText('Nail on the back panel');
    await expect(page.getByTestId('next-irreversible')).toHaveCount(0);
    const content = page.getByTestId('step-content');
    const first = content.locator('[role="note"]').first();
    await expect(first).toHaveAttribute('data-kind', 'irreversible');
    await expect(first).toContainText("Can't be undone");
    await expect(first).toContainText('Check the picture and the parts before you do this step.');
    // the manual's own warning follows, verbatim
    await expect(content.locator('[data-kind="warning"]')).toContainText('Once nailed, the back panel cannot be removed without damage.');
    await expect(primary(page)).toHaveAccessibleName('I checked - done');
    await expect(primary(page)).toHaveText('I checked'); // short form on a phone; the full label is the accessible name
    const border = await page.getByTestId('action-bar').evaluate((e) => getComputedStyle(e).borderTopWidth);
    expect(border).toBe('2px');
    await expect(page.getByTestId('step-counter')).toBeVisible();
    // a plain tap completes, no hold gesture
    await primary(page).click();
    await expect(page).toHaveURL(/step=s8/);
    await context.close();
  });

  test('low confidence: banner, dashed brackets and the persistent visual tag', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s8');
    await visualReady(page);
    const banner = page.getByTestId('step-content').locator('[data-kind="unsure"]');
    await expect(banner).toContainText('Double-check');
    await expect(banner).toContainText("We're less sure we read this step correctly. Compare it with the original page.");
    await expect(visual(page)).toHaveAttribute('data-tag', 'lowConfidence');
    await expect(page.getByTestId('visual-tag')).toHaveText('Double-check with the original');
    await expect(visual(page).getByTestId('mark').first()).toHaveAttribute('data-dashed', 'true');
    await banner.getByRole('button', { name: 'Show original page' }).click();
    await expect(page.getByTestId('viewer-page')).toHaveText('Page 6 of 6');
    await context.close();
  });

  test('missing part: banner with the quantity, chip state, rail flag, "I found it" clears it', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { checklist: { 'cam-lock': 'missing' } });
    await openPlayer(page, guideId, '?step=s4');
    const banner = page.getByTestId('step-content').locator('[data-kind="caution"]').filter({ hasText: 'Missing part' });
    await expect(banner).toContainText(/You marked Cam lock .* as missing\. This step needs \d+\./);
    await expect(page.getByTestId('step-chips').getByRole('button', { name: /Cam lock/ })).toContainText('Missing');
    await expect(primary(page)).toBeEnabled(); // never blocks
    await page.getByTestId('steps-button').click();
    await expect(page.getByRole('dialog', { name: 'Steps' })).toBeVisible();
    await expect(page.locator('[data-rail-row][data-step="s4"]')).toContainText('Needs a part you marked missing');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Steps' })).toBeHidden();
    await banner.getByRole('button', { name: 'I found it' }).click();
    await expect(banner).toHaveCount(0);
    await expect.poll(savedProgress(context)).toMatchObject({ checklist: { 'cam-lock': 'have' } });
    await context.close();
  });

  test('a step without parts omits the group; a checkpoint is shown when the guide has one', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s8');
    await expect(page.getByTestId('step-chips')).toHaveCount(0); // no parts or tools: group omitted
    await expect(page.getByTestId('checkpoint')).toHaveCount(0);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(stepTitle(page)).toContainText('Fit the cam bolts'); // fast key repeat never skips a step
    await expect(page.getByTestId('checkpoint')).toContainText("You'll know it's right when");
    await expect(page.getByTestId('checkpoint')).toContainText("You'll know it's right when");
    await context.close();
  });
});

test.describe('device features', () => {
  test('read aloud speaks irreversible, warnings, title, instruction, checkpoint; stops on step change', async ({ browser }) => {
    const { context, page } = await start(browser);
    await context.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [] as string[];
      w.__cancels = 0;
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          speak: (u: { text: string }) => (w.__spoken as string[]).push(u.text),
          cancel: () => ((w.__cancels as number)++, undefined),
        },
      });
      (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
        text: string;
        constructor(t: string) {
          this.text = t;
        }
      };
    });
    await openPlayer(page, guideId, '?step=s7');
    await page.getByTestId('read-aloud').click();
    const spoken = () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
    const lines = await spoken();
    expect(lines[0]).toMatch(/can't be undone/);
    expect(lines[1]).toMatch(/^Warning: /);
    expect(lines.some((l) => l === 'Nail on the back panel')).toBe(true);
    await expect(page.getByTestId('read-aloud')).toHaveAttribute('aria-pressed', 'true');
    const cancelsBefore = await page.evaluate(() => (window as unknown as { __cancels: number }).__cancels);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __cancels: number }).__cancels)).toBeGreaterThan(cancelsBefore);
    await expect(page.getByTestId('read-aloud')).toHaveAttribute('aria-pressed', 'false');
    await context.close();
  });

  test('read aloud and the screen lock are hidden or off where unsupported, and nothing breaks', async ({ browser }) => {
    const { context, page } = await start(browser);
    await context.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).speechSynthesis;
      delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
      Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, value: undefined });
    });
    await openPlayer(page, guideId, '?step=s2');
    await expect(page.getByTestId('read-aloud')).toHaveCount(0);
    await page.getByRole('button', { name: 'More options for this guide' }).click();
    await expect(page.getByRole('menuitem', { name: /Read each step aloud/ })).toHaveCount(0);
    const keep = page.getByRole('menuitemcheckbox', { name: /Keep screen on/ });
    await expect(keep).toBeDisabled();
    await expect(keep).toContainText("Your browser can't keep the screen on. Set your phone's auto-lock to a longer time.");
    await context.close();
  });

  test('the screen wake lock is requested while the player is open', async ({ browser }) => {
    const { context, page } = await start(browser);
    await context.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__wake = 0;
      Object.defineProperty(Navigator.prototype, 'wakeLock', {
        configurable: true,
        value: { request: async () => ((w.__wake as number)++, { release: async () => {}, addEventListener: () => {} }) },
      });
    });
    await openPlayer(page, guideId, '?step=s2');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: number }).__wake)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'More options for this guide' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: /Keep screen on/ })).toHaveAttribute('aria-checked', 'true');
    await context.close();
  });

  test('offline: an info banner appears', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s2');
    await context.setOffline(true);
    await expect(page.getByText("You're offline. Steps you've opened still work; asking questions needs a connection.")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText("You're offline.")).toBeHidden();
    await context.close();
  });
});

test.describe('first run and focus', () => {
  test('a one-line coach appears on step 1 only until dismissed, and stays dismissed', async ({ browser }) => {
    const { context, page } = await start(browser);
    await openPlayer(page, guideId, '?step=s1');
    const coach = page.getByTestId('coach');
    await expect(coach).toContainText("Swipe or use the arrows to look around. Tap Done when you've finished a step.");
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('coach')).toHaveCount(0);
    await page.keyboard.press('ArrowLeft');
    await expect(coach).toBeVisible();
    await coach.getByRole('button', { name: 'Got it' }).click();
    await expect(coach).toHaveCount(0);
    await page.reload();
    await expect(stepTitle(page)).toBeVisible();
    await expect(page.getByTestId('coach')).toHaveCount(0);
    await context.close();
  });

  test('closing the viewer returns focus to the control that opened it', async ({ browser }) => {
    const { context, page } = await start(browser, '768');
    await openPlayer(page, guideId, '?step=s2');
    await visualReady(page);
    await page.getByTestId('original-page').click();
    await expect(page.getByTestId('original-viewer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('original-viewer')).toBeHidden();
    await expect(page.getByTestId('original-page')).toBeFocused();
    await context.close();
  });
});

test.describe('keyboard only', () => {
  test('every action is reachable without a pointer', async ({ browser }) => {
    const { context, page } = await start(browser, '1280');
    await openPlayer(page, guideId, '?step=s1');
    await visualReady(page);

    // Ctrl+Enter completes and advances
    await page.keyboard.press('Control+Enter');
    await expect(page).toHaveURL(/step=s2/);
    await expect.poll(savedProgress(context)).toMatchObject({ completedStepIds: ['s1'] });
    // A and / open Ask; Esc closes; O opens the original; Esc closes
    await page.keyboard.press('a');
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('assistant-panel')).toBeHidden();
    await page.keyboard.press('/');
    await expect(page.getByTestId('assistant-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('o');
    await expect(page.getByTestId('original-viewer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('original-viewer')).toBeHidden();
    // Esc with no overlay focuses Close and does not leave
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('leave-guide')).toBeFocused();
    await expect(page).toHaveURL(/\/play\?step=s2/);

    // Tab reaches the primary button; Enter on it completes
    await primary(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/step=s3/);
    await expect(stepTitle(page)).toBeFocused();
    // rail: Home / End jump focus
    const rail = page.getByRole('navigation', { name: 'Steps' });
    await rail.locator('[aria-current="step"]').focus();
    await page.keyboard.press('End');
    await expect(rail.locator('[data-step="s10"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(rail.locator('[data-step="s1"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/step=s1/);
    // typing in an input would not trigger shortcuts: none exist here, but modifier combos are ignored
    await page.keyboard.press('Control+a');
    await expect(page.getByRole('dialog', { name: 'Ask about this step' })).toBeHidden();
    await context.close();
  });

  test('focus is trapped in the Steps sheet and returns to the Steps button', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    await openPlayer(page, guideId, '?step=s2');
    const steps = page.getByTestId('steps-button');
    await steps.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Steps' });
    await expect(sheet).toBeVisible();
    for (let i = 0; i < 16; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(steps).toBeFocused();
    await context.close();
  });
});
