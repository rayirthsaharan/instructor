import { expect, test } from '@playwright/test';
import { doc, FakeApi, guide, newPage, noHorizontalScroll, routeGuide, SHOT, type VpName } from './m1-helpers';

const shots: VpName[] = ['375', '1280'];

const stageText = (page: import('@playwright/test').Page) =>
  page.getByRole('list', { name: 'Progress' }).locator('li').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-marker')}:${(e.querySelector('p')?.firstChild?.textContent ?? '').trim()}`));

for (const scheme of ['light', 'dark'] as const) {
  for (const vp of shots) {
    test(`processing ${scheme} @ ${vp}: running, failed, rejected, loading`, async ({ browser }) => {
      const { page, context } = await newPage(browser, vp, scheme);
      const api = new FakeApi();
      await api.install(page);

      api.docs['run'] = doc({ id: 'run', stage: 'render', pagesRendered: 8, pageCount: 20 });
      await page.goto('/d/run');
      await expect(page.getByRole('heading', { name: 'Reading your manual', level: 1 })).toBeVisible();
      await expect(page.getByText('Page 8 of 20')).toBeVisible();
      await expect(page.getByText('This usually takes about a minute. You can leave this page - we\'ll keep going.')).toBeVisible();
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOT}/processing-running-${vp}-${scheme}.png`, fullPage: true, animations: 'disabled' });

      api.docs['bad'] = doc({ id: 'bad', status: 'failed', stage: 'verify', error: { code: 'verify_failed', message: 'x' } });
      await page.goto('/d/bad');
      await expect(page.getByText("We built the steps but couldn't verify them against the original, so we haven't shown them.")).toBeVisible();
      await page.screenshot({ path: `${SHOT}/processing-failed-${vp}-${scheme}.png`, fullPage: true, animations: 'disabled' });

      api.docs['rej'] = doc({ id: 'rej', status: 'rejected', stage: null, error: { code: 'not_a_manual', message: 'x' } });
      await page.goto('/d/rej');
      await expect(page.getByRole('heading', { name: "This doesn't look like instructions" })).toBeVisible();
      await page.screenshot({ path: `${SHOT}/processing-rejected-${vp}-${scheme}.png`, fullPage: true, animations: 'disabled' });

      // Loading skeleton while the first answer is on its way
      await page.route('**/api/documents/slow', async (r) => {
        await new Promise((res) => setTimeout(res, 1500));
        await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc({ id: 'slow' })) });
      });
      await page.goto('/d/slow');
      await expect(page.getByRole('status').getByText('Loading')).toBeAttached();
      await page.screenshot({ path: `${SHOT}/processing-loading-${vp}-${scheme}.png`, fullPage: true, animations: 'disabled' });
      await context.close();
    });
  }
}

test('stages follow the real state and are announced politely', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  await api.install(page);

  api.docs['j'] = doc({ id: 'j', status: 'queued', stage: null, pageCount: null, pagesRendered: null, progress: 0 });
  await page.goto('/d/j');
  await expect(page.getByRole('list', { name: 'Progress' })).toHaveAttribute('aria-live', 'polite');
  expect(await stageText(page)).toEqual(['pending:Reading pages', 'pending:Finding parts and building steps', 'pending:Double-checking', 'pending:Finishing']);
  await expect(page.getByText('Waiting to start')).toBeVisible();

  api.docs['j'] = doc({ id: 'j', stage: 'render', pagesRendered: 3, pageCount: 12 });
  await expect(page.getByText('Page 3 of 12')).toBeVisible({ timeout: 6000 });
  expect(await stageText(page)).toEqual(['active:Reading pages', 'pending:Finding parts and building steps', 'pending:Double-checking', 'pending:Finishing']);

  api.docs['j'] = doc({ id: 'j', stage: 'analyse', pagesRendered: 12, pageCount: 12 });
  await expect.poll(async () => (await stageText(page))[0], { timeout: 8000 }).toBe('done:Reading pages');
  expect((await stageText(page))[1]).toBe('active:Finding parts and building steps');

  api.docs['j'] = doc({ id: 'j', stage: 'verify', pagesRendered: 12, pageCount: 12 });
  await expect(page.getByText('Comparing numbers and part labels with the original')).toBeVisible({ timeout: 8000 });
  expect(await stageText(page)).toEqual(['done:Reading pages', 'done:Finding parts and building steps', 'active:Double-checking', 'pending:Finishing']);
  await page.screenshot({ path: `${SHOT}/processing-verify-768-light.png`, fullPage: true, animations: 'disabled' });
  await context.close();
});

test('ready: redirects (replace) to /g/<guideId> and the placeholder shows the title', async ({ browser }) => {
  const { page, context } = await newPage(browser, '375');
  const api = new FakeApi();
  api.guides = [guide({ id: 'g7', documentId: 'j', title: 'Orchard garden shed assembly' })];
  api.docs['j'] = doc({ id: 'j', stage: 'verify' });
  await api.install(page);
  await routeGuide(page, 'g7', 'Orchard garden shed assembly');
  await page.goto('/');
  await page.goto('/d/j');
  api.docs['j'] = doc({ id: 'j', status: 'ready', stage: 'publish', progress: 1, guideId: 'g7' });
  await expect(page).toHaveURL(/\/g\/g7$/, { timeout: 8000 });
  await expect(page.getByRole('heading', { name: 'Orchard garden shed assembly' })).toBeVisible();
  await expect(page.getByText("Here's the plan")).toBeVisible();
  await page.screenshot({ path: `${SHOT}/guide-placeholder-375-light.png`, animations: 'disabled' });
  // The Processing URL is not left in history
  await page.goBack();
  await expect(page).not.toHaveURL(/\/d\/j$/);
  await context.close();
});

test('opening a finished job later redirects straight away; a reload mid-job resumes at the real stage', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.guides = [guide({ id: 'g8', documentId: 'done', title: 'Ready one' })];
  api.docs['done'] = doc({ id: 'done', status: 'ready', stage: 'publish', progress: 1, guideId: 'g8' });
  api.docs['mid'] = doc({ id: 'mid', stage: 'analyse' });
  await api.install(page);
  await page.goto('/d/done');
  await expect(page).toHaveURL(/\/g\/g8$/);

  await page.goto('/d/mid');
  await expect(page.getByTestId('state-processing')).toBeVisible();
  await page.reload();
  await expect.poll(async () => (await stageText(page))[1]).toBe('active:Finding parts and building steps');
  await context.close();
});

test('failed: stage-specific message, failed marker, Try again resumes; third failure changes the copy', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.docs['f'] = doc({ id: 'f', status: 'failed', stage: 'render', error: { code: 'render_failed', message: 'x' } });
  await api.install(page);
  await page.goto('/d/f');
  await expect(page.getByText("We couldn't read this file's pages.", { exact: true })).toBeVisible();
  expect(await stageText(page)).toEqual(['failed:Reading pages', 'pending:Finding parts and building steps', 'pending:Double-checking', 'pending:Finishing']);
  await expect(page.getByRole('link', { name: 'Use a different file' })).toHaveAttribute('href', '/new');

  await expect(page.getByRole('heading', { name: "We couldn't finish your guide", level: 1 })).toBeVisible();

  // Try again -> job runs
  api.docs['f'] = doc({ id: 'f', stage: 'render' });
  await page.getByRole('button', { name: 'Try again' }).click();
  expect(api.calls).toContain('POST /api/documents/f/retry');
  await expect(page.getByTestId('state-processing')).toHaveAttribute('data-status', 'processing');

  // Fails in analyse after the first retry: finding-parts copy, retry still offered
  api.docs['f'] = doc({ id: 'f', status: 'failed', stage: 'analyse', attempts: 3, retryCount: 1, error: { code: 'x', message: 'x' } });
  await expect(page.getByText("We couldn't build a guide from this manual. This is on our side.", { exact: true })).toBeVisible({ timeout: 8000 });
  expect((await stageText(page))[0]).toBe('done:Reading pages');
  await page.getByRole('button', { name: 'Try again' }).click();
  api.docs['f'] = doc({ id: 'f', status: 'failed', stage: 'analyse', attempts: 3, retryCount: 2, error: { code: 'x', message: 'x' } });
  await expect(page.getByText(/It's still not working\. Your manual is saved; try again later\./)).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to library' })).toBeVisible();
  await page.screenshot({ path: `${SHOT}/processing-failed-repeated-768-light.png`, fullPage: true, animations: 'disabled' });
  await context.close();
});

test('a publish-stage failure uses the same failed title and never "Reading your manual"', async ({ browser }) => {
  const { page, context } = await newPage(browser, '375');
  const api = new FakeApi();
  api.docs['p'] = doc({ id: 'p', status: 'failed', stage: 'publish', attempts: 3, retryCount: 0, error: { code: 'x', message: 'x' } });
  await api.install(page);
  await page.goto('/d/p');
  await expect(page.getByRole('heading', { name: "We couldn't finish your guide", level: 1 })).toBeVisible();
  await expect(page.getByText('Reading your manual')).toHaveCount(0);
  // The server's own 3 attempts do not count as the user's repeated failure.
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByText(/still not working/)).toHaveCount(0);
  await context.close();
});

test('failed retry request failing shows a message and keeps the Try again action', async ({ browser }) => {
  const { page, context } = await newPage(browser, '375');
  const api = new FakeApi();
  api.retryStatus = 500;
  api.docs['f'] = doc({ id: 'f', status: 'failed', stage: 'verify', error: { code: 'x', message: 'x' } });
  await api.install(page);
  await page.goto('/d/f');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText("We couldn't restart that.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await context.close();
});

test('every pages unreadable: the specified message', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.docs['u'] = doc({ id: 'u', status: 'failed', stage: 'render', error: { code: 'all_pages_unreadable', message: 'x' } });
  await api.install(page);
  await page.goto('/d/u');
  await expect(page.getByText("We couldn't read these pages. Try photos in brighter light, with each page flat and filling the frame.")).toBeVisible();
  await context.close();
});

test('rejected: not a manual, with both actions and no stage list', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.docs['r'] = doc({ id: 'r', status: 'rejected', stage: null, error: { code: 'not_a_manual', message: 'x' } });
  await api.install(page);
  await page.goto('/d/r');
  await expect(page.getByText("We look for manuals and step-by-step guides - for example assembly or setup instructions. This file seems to be something else.")).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try a different file' })).toHaveAttribute('href', '/new');
  await expect(page.getByRole('link', { name: 'Back to library' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('list', { name: 'Progress' })).toHaveCount(0);
  await context.close();
});

test('document not found', async ({ browser }) => {
  const { page, context } = await newPage(browser, '375');
  const api = new FakeApi();
  await api.install(page);
  await page.goto('/d/nope');
  await expect(page.getByRole('heading', { name: "This manual isn't on this device." })).toBeVisible();
  await page.getByRole('link', { name: 'Back to library' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.screenshot({ path: `${SHOT}/processing-notfound-375-light.png`, animations: 'disabled' });
  await context.close();
});

test('connection lost: reconnecting banner, then silent recovery', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.docs['c'] = doc({ id: 'c', stage: 'analyse' });
  await api.install(page);
  await page.goto('/d/c');
  await expect(page.getByTestId('state-processing')).toBeVisible();
  api.docFail = true;
  await expect(page.getByText('Reconnecting... your manual is still being read.')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${SHOT}/processing-reconnecting-768-light.png`, fullPage: true, animations: 'disabled' });
  api.docFail = false;
  await expect(page.getByText('Reconnecting...')).toHaveCount(0, { timeout: 15000 });
  await context.close();
});

test('slow: unchanged stage for over 60 s adds the line under the active stage', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.docs['s'] = doc({ id: 's', stage: 'analyse' });
  await api.install(page);
  await page.clock.install();
  await page.goto('/d/s');
  await expect(page.getByTestId('state-processing')).toBeVisible();
  await expect(page.getByText('Still working - long manuals take longer.')).toHaveCount(0);
  for (let i = 0; i < 14; i++) await page.clock.runFor(5000);
  await expect(page.getByText('Still working - long manuals take longer.')).toBeVisible();
  await context.close();
});

test('polling backs off while nothing changes', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.docs['b'] = doc({ id: 'b', stage: 'analyse' });
  await api.install(page);
  await page.clock.install();
  await page.goto('/d/b');
  await expect(page.getByTestId('state-processing')).toBeVisible();
  const count = () => api.calls.filter((c) => c === 'GET /api/documents/b').length;
  await page.clock.runFor(30_000);
  // Fixed 1 s polling would make ~31 requests; 1 -> 1.5 -> ... -> 5 s backoff makes far fewer.
  await expect.poll(count).toBeLessThan(15);
  await expect.poll(count).toBeGreaterThan(4);
  await context.close();
});

test('keyboard: Back to library is reachable and focus is visible', async ({ browser }) => {
  const { page, context } = await newPage(browser, '768');
  const api = new FakeApi();
  api.docs['k'] = doc({ id: 'k', stage: 'analyse' });
  await api.install(page);
  await page.goto('/d/k');
  await expect(page.getByTestId('state-processing')).toBeVisible();
  const link = page.getByRole('link', { name: 'Back to library' });
  for (let i = 0; i < 4 && !(await link.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  await context.close();
});
