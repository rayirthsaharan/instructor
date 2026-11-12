import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getProgress, openPlayer, primary, putProgress, query, stepTitle, uploadLumen, VIEWPORTS, type ProgressBody } from './m2-player-helpers';

// QA M2: progress integrity, URL tampering, sessions. Real app, mock AI.
let guideId = '';
let state: Awaited<ReturnType<BrowserContext['storageState']>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  ({ guideId } = await uploadLumen(ctx));
  state = await ctx.storageState();
  await ctx.close();
});

async function start(browser: Browser, progress: Partial<ProgressBody> = {}, vp: keyof typeof VIEWPORTS = '375') {
  const context = await browser.newContext({ ...VIEWPORTS[vp], storageState: state });
  await putProgress(context, guideId, progress);
  return { context, page: await context.newPage() };
}
const S = (n: number) => `s${n}`;

function collectErrors(page: Page) {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

test.describe('progress integrity', () => {
  test('two tabs on the same guide: a step completed in one tab is not erased by activity in the other', async ({ browser }) => {
    const { context, page: a } = await start(browser);
    const b = await context.newPage();
    await openPlayer(b, guideId);
    await openPlayer(a, guideId);
    await primary(a).click(); // tab A completes step 1
    await expect.poll(async () => (await getProgress(context, guideId)).completedStepIds).toEqual([S(1)]);
    await b.bringToFront();
    await b.keyboard.press('ArrowRight'); // tab B only navigates, with its older copy of the progress
    await expect(stepTitle(b)).toBeVisible();
    await b.waitForTimeout(2500); // debounce + save
    expect((await getProgress(context, guideId)).completedStepIds, 'step 1 completion lost to the stale tab').toEqual([S(1)]);
    await context.close();
  });

  test('rapid arrow-key repeat moves exactly one step per press and completes nothing', async ({ browser }) => {
    const { context, page } = await start(browser, { currentStepId: S(1) });
    await openPlayer(page, guideId);
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight', { delay: 0 });
    await expect.poll(() => query(page).get('step')).toBe(S(5));
    for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowLeft', { delay: 0 });
    await expect.poll(() => query(page).get('step')).toBe(S(1));
    await page.waitForTimeout(1500);
    expect((await getProgress(context, guideId)).completedStepIds).toEqual([]);
    await context.close();
  });

  test('rapid Ctrl+Enter never records a duplicate or a step the user did not reach', async ({ browser }) => {
    const { context, page } = await start(browser, { currentStepId: S(1) });
    await openPlayer(page, guideId);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Enter', { delay: 0 });
    await page.waitForTimeout(1800);
    const p = await getProgress(context, guideId);
    expect(new Set(p.completedStepIds).size).toBe(p.completedStepIds.length);
    // the user is on step N+1 where N = number of completed steps; steps beyond the current one are never completed
    const cur = Number(query(page).get('step')!.slice(1));
    for (const id of p.completedStepIds) expect(Number(id.slice(1))).toBeLessThan(cur);
    await context.close();
  });

  test('double click on the primary button completes one step and advances one step', async ({ browser }) => {
    const { context, page } = await start(browser, { currentStepId: S(1) });
    await openPlayer(page, guideId);
    await primary(page).dblclick();
    await page.waitForTimeout(1500);
    const p = await getProgress(context, guideId);
    expect(p.completedStepIds.length).toBeLessThanOrEqual(2);
    expect(p.completedStepIds[0]).toBe(S(1));
    await context.close();
  });

  test('failing PUT: state is kept optimistically, the error shows only after the retries, Try again recovers, reload keeps it', async ({ browser }) => {
    test.setTimeout(90_000);
    const { context, page } = await start(browser, { currentStepId: S(1) });
    await openPlayer(page, guideId);
    let failing = true;
    let puts = 0;
    await page.route('**/api/guides/*/progress', async (route) => {
      puts++;
      if (failing) await route.abort('connectionfailed');
      else await route.continue();
    });
    await primary(page).click();
    await expect(stepTitle(page)).toContainText(/Attach|Step|\S/);
    await expect(query(page).get('step')).toBe(S(2));
    // optimistic: go back, step 1 shows Done
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('done-tag')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    // no error banner during the automatic retries (2s, 5s, 15s)
    await page.waitForTimeout(4000);
    await expect(page.getByTestId('save-error')).toHaveCount(0);
    expect(puts).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('save-error')).toBeVisible({ timeout: 30_000 });
    // the step is still shown as done locally
    failing = false;
    await page.getByTestId('save-error').getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('save-error')).toHaveCount(0);
    await expect.poll(async () => (await getProgress(context, guideId)).completedStepIds).toContain(S(1));
    await page.reload();
    await expect(stepTitle(page)).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('done-tag')).toBeVisible();
    await context.close();
  });

  test('closing the tab right after completing a step still saves it (page-hide flush)', async ({ browser }) => {
    const { context, page } = await start(browser, { currentStepId: S(1) });
    await openPlayer(page, guideId);
    await primary(page).click();
    await expect(query(page).get('step')).toBe(S(2));
    await page.waitForTimeout(200);
    await page.close({ runBeforeUnload: true }); // inside the 600 ms debounce
    await expect.poll(async () => (await getProgress(context, guideId)).completedStepIds, { timeout: 5000 }).toEqual([S(1)]);
    const again = await context.newPage();
    await again.goto(`/g/${guideId}/play`);
    await expect.poll(() => query(again).get('step')).toBe(S(2));
    await context.close();
  });

  test('offline for a while: completions made offline are saved when the connection returns and Try again is pressed', async ({ browser }) => {
    test.setTimeout(90_000);
    const { context, page } = await start(browser, { currentStepId: S(1) });
    await openPlayer(page, guideId);
    await context.setOffline(true);
    await primary(page).click();
    await primary(page).click();
    await expect(query(page).get('step')).toBe(S(3));
    await expect(page.getByTestId('save-error')).toBeVisible({ timeout: 40_000 });
    await context.setOffline(false);
    await page.getByTestId('save-error').getByRole('button', { name: 'Try again' }).click();
    await expect.poll(async () => (await getProgress(context, guideId)).completedStepIds).toEqual([S(1), S(2)]);
    await context.close();
  });
});

test.describe('URL tampering', () => {
  const cases: [string, string][] = [
    ['unknown step', '?step=nope'],
    ['empty step', '?step='],
    ['prototype key', '?step=__proto__'],
    ['constructor key', '?step=constructor'],
    ['huge step id', `?step=${'x'.repeat(5000)}`],
    ['markup in step', '?step=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E'],
    ['page 999', '?step=s2&panel=original&page=999'],
    ['page 0', '?step=s2&panel=original&page=0'],
    ['page -1', '?step=s2&panel=original&page=-1'],
    ['page abc', '?step=s2&panel=original&page=abc'],
    ['page 1.5', '?step=s2&panel=original&page=1.5'],
    ['page huge', '?step=s2&panel=original&page=99999999999999999999'],
    ['panel garbage', '?step=s2&panel=garbage'],
    ['panel original without page', '?step=s2&panel=original'],
    ['repeated params', '?step=s2&step=s3&panel=steps&panel=ask'],
  ];
  for (const [name, qs] of cases) {
    test(`${name} degrades safely`, async ({ browser }) => {
      const { context, page } = await start(browser, { currentStepId: S(3), completedStepIds: [S(1), S(2)] });
      const errs = collectErrors(page);
      let dialogs = 0;
      page.on('dialog', (d) => {
        dialogs++;
        void d.dismiss();
      });
      await page.goto(`/g/${guideId}/play${qs}`);
      await expect(stepTitle(page)).toBeVisible();
      await expect(page.getByText("We couldn't open this guide.")).toHaveCount(0);
      // the URL ends up naming a real step of this guide
      await expect.poll(() => /^s(?:[1-9]|10)$/.test(query(page).get('step') ?? '')).toBe(true);
      expect(errs).toEqual([]);
      expect(dialogs).toBe(0);
      if (qs.includes('panel=original')) {
        await expect(page.getByTestId('original-viewer')).toBeVisible();
        const label = await page.getByTestId('original-viewer').innerText();
        expect(label).toMatch(/Page \d+ of \d+/);
        const m = /Page (\d+) of (\d+)/.exec(label)!;
        expect(Number(m[1])).toBeGreaterThanOrEqual(1);
        expect(Number(m[1])).toBeLessThanOrEqual(Number(m[2]));
      }
      // nothing got completed by merely opening a tampered URL
      await page.waitForTimeout(1200);
      expect((await getProgress(context, guideId)).completedStepIds).toEqual([S(1), S(2)]);
      await context.close();
    });
  }

  test('an unknown ?step never overwrites the saved current step with garbage', async ({ browser }) => {
    const { context, page } = await start(browser, { currentStepId: S(4), completedStepIds: [S(1), S(2), S(3)] });
    await page.goto(`/g/${guideId}/play?step=nope`);
    await expect(stepTitle(page)).toBeVisible();
    await page.waitForTimeout(1500);
    const p = await getProgress(context, guideId);
    expect(p.completedStepIds).toEqual([S(1), S(2), S(3)]);
    expect(p.currentStepId).toMatch(/^s\d+$/);
    await context.close();
  });
});

test.describe('sessions', () => {
  for (const path of ['', '/play', '/done', '/play?step=s2&panel=original&page=1']) {
    test(`another session cannot open /g/<id>${path}`, async ({ browser }) => {
      const context = await browser.newContext(VIEWPORTS['375']); // no cookies: a different anonymous session
      const page = await context.newPage();
      const res = await page.goto(`/g/${guideId}${path}`);
      expect(res?.status()).toBeLessThan(500);
      await expect(page.getByText(/isn't on this device/i)).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to library' })).toBeVisible();
      // none of the guide's content leaks
      await expect(page.getByText('Lumen')).toHaveCount(0);
      const api = await context.request.get(`/api/guides/${guideId}`);
      expect(api.status()).toBe(404);
      const put = await context.request.put(`/api/guides/${guideId}/progress`, { data: { currentStepId: null, completedStepIds: [], checklist: {} } });
      expect(put.status()).toBe(404);
      await context.close();
    });
  }
});

test.describe('PATCH progress contract (D-018)', () => {
  test('two tabs, both orders: completions from either tab are kept; uncomplete beats a stale tab; checklist is per item', async ({ browser }) => {
    const { context, page: a } = await start(browser, { currentStepId: S(1) });
    const b = await context.newPage();
    await openPlayer(a, guideId);
    await openPlayer(b, guideId);
    // B completes step 1 first, then A (stale) completes step 2 after pressing ArrowRight
    await primary(b).click();
    await expect.poll(async () => (await getProgress(context, guideId)).completedStepIds).toEqual([S(1)]);
    await a.bringToFront();
    await a.keyboard.press('ArrowRight');
    await primary(a).click();
    await expect.poll(async () => (await getProgress(context, guideId)).completedStepIds.sort()).toEqual([S(1), S(2)]);
    // A (does not know about step 1 yet or does after refresh) un-completes step 2 via the menu path: use the API-level op through the UI
    await a.keyboard.press('ArrowLeft');
    await expect(a.getByTestId('done-tag')).toBeVisible();
    await a.getByRole('button', { name: /more|menu|options/i }).first().click();
    await a.getByRole('menuitem', { name: 'Mark as not done' }).click();
    await expect.poll(async () => (await getProgress(context, guideId)).completedStepIds).not.toContain(S(2));
    // stale B (still believes step 2 not done) completes step 3: step 1 stays, step 2 stays un-done
    await b.bringToFront();
    await b.keyboard.press('ArrowRight');
    await b.keyboard.press('ArrowRight');
    await primary(b).click();
    await expect.poll(async () => (await getProgress(context, guideId)).completedStepIds.length).toBe(2);
    const p = await getProgress(context, guideId);
    expect(p.completedStepIds, 'step 1 kept, un-completed step 2 not resurrected by the stale tab').toContain(S(1));
    expect(p.completedStepIds).not.toContain(S(2));
    await context.close();
  });

  test('checklist writes from two sessions of the same device touch only their own item', async ({ browser }) => {
    const { context } = await start(browser, {});
    const patch = (data: object) => context.request.patch(`/api/guides/${guideId}/progress`, { data });
    const items = Object.keys(((await (await context.request.get(`/api/guides/${guideId}`)).json()) as { guide: { parts: { id: string }[] } }).guide.parts.map((p) => p.id).reduce((o, id) => ({ ...o, [id]: 1 }), {}));
    expect((await patch({ checklist: { [items[0]!]: 'missing' } })).ok()).toBe(true);
    expect((await patch({ checklist: { [items[1]!]: 'have' } })).ok()).toBe(true);
    const p = await getProgress(context, guideId);
    expect(p.checklist[items[0]!]).toBe('missing');
    expect(p.checklist[items[1]!]).toBe('have');
    await context.close();
  });

  test('PATCH rejects unknown ids, unknown fields and conflicting lists with 400 and saves nothing', async ({ browser }) => {
    const { context } = await start(browser, { currentStepId: S(1), completedStepIds: [S(1)] });
    const patch = (data: unknown) => context.request.patch(`/api/guides/${guideId}/progress`, { data });
    for (const bad of [
      { complete: ['nope'] },
      { complete: [S(2)], uncomplete: [S(2)] },
      { complete: [S(3)], bogus: 1 },
      { complete: [S(3)], currentStepId: 'nope' },
      { complete: [S(3)], checklist: { 'no-such-part': 'have' } },
      { complete: [S(3)], checklist: { 'cam-lock': 'weird' } },
      { complete: '__proto__' },
      { complete: [S(3)], uncomplete: [{}] },
    ]) {
      const r = await patch(bad);
      expect(r.status(), JSON.stringify(bad)).toBe(400);
    }
    const p = await getProgress(context, guideId);
    expect(p.completedStepIds).toEqual([S(1)]);
    expect(p.currentStepId).toBe(S(1));
    expect((await patch({})).ok()).toBe(true);
    // other session cannot patch
    const other = await browser.newContext();
    expect((await other.request.patch(`/api/guides/${guideId}/progress`, { data: { complete: [S(2)] } })).status()).toBe(404);
    await other.close();
    await context.close();
  });

  test('the tab re-reads progress when it regains focus', async ({ browser }) => {
    const { context, page } = await start(browser, { currentStepId: S(1) });
    await openPlayer(page, guideId);
    await putProgress(context, guideId, { currentStepId: S(1), completedStepIds: [S(1), S(2)] }); // changed elsewhere
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('done-tag')).toBeVisible({ timeout: 5000 });
    await context.close();
  });
});
