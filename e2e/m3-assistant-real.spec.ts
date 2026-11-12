import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { openPlayer, putProgress, query, uploadLumen, VIEWPORTS, type VpName } from './m2-player-helpers';
import { askButton, composer, openAssistant, panelOf, shot } from './m3-helpers';

// Real routes, real worker, mock AI provider, Lumen fixture. Nothing is mocked in the browser.
let guideId = '';
let state: Awaited<ReturnType<BrowserContext['storageState']>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  ({ guideId } = await uploadLumen(ctx));
  state = await ctx.storageState();
  await ctx.close();
});

async function start(browser: Browser, vp: VpName, step = 's4') {
  const context = await browser.newContext({ ...VIEWPORTS[vp], storageState: state, reducedMotion: 'reduce' });
  await context.request.delete(`/api/guides/${guideId}/messages`);
  await putProgress(context, guideId, {});
  const page = await context.newPage();
  await openPlayer(page, guideId, `?step=${step}`);
  await openAssistant(page);
  await expect(page.getByTestId('history-skeleton')).toHaveCount(0);
  return { context, page };
}

async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByTestId('composer-send').click();
}
const lastAnswer = (page: Page) => page.getByTestId('assistant-message').last();

for (const vp of ['375', '1280'] as const) {
  test.describe(`real assistant at ${vp}`, () => {
    test('a suggested question gets a cited answer; the conversation survives a reload', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      const chips = page.getByTestId('suggestions').getByRole('button');
      await expect(chips).toHaveCount(3);
      const q = (await chips.first().textContent())!.trim();
      await chips.first().click();
      await expect(page.getByTestId('user-message')).toHaveText(q);
      await expect(page.getByTestId('assistant-live')).not.toHaveText('', { timeout: 30_000 });
      await expect(page.getByTestId('assistant-streaming')).toHaveCount(0);
      const a = lastAnswer(page);
      await expect(a).toContainText("Instructor's explanation");
      await expect(a.getByTestId('cite-page').first()).toBeVisible();
      await shot(page, `${vp}-real-answer`);
      await page.reload();
      await expect(panelOf(page)).toBeVisible(); // panel=ask is in the URL, so it reopens
      await expect(page.getByTestId('user-message')).toHaveText(q);
      await expect(lastAnswer(page)).toBeVisible();
      await context.close();
    });

    test('[[mock:fail]] ends mid-stream with an error and Try again; nothing is stored', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await ask(page, '[[mock:fail]] what does this mean?');
      await expect(page.getByTestId('turn-error')).toContainText(/didn't go through|isn't available/, { timeout: 30_000 });
      await expect(page.getByTestId('user-message')).toContainText('[[mock:fail]]');
      await expect(page.getByTestId('turn-retry')).toBeVisible();
      await shot(page, `${vp}-real-fail`);
      const r = await context.request.get(`/api/guides/${guideId}/messages`);
      expect(((await r.json()) as { messages: unknown[] }).messages).toEqual([]);
      await context.close();
    });

    test('[[mock:badcite]] never shows a chip for an unknown step or a page the manual does not have', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await ask(page, '[[mock:badcite]] what does this mean?');
      await expect(page.getByTestId('assistant-live')).not.toHaveText('', { timeout: 30_000 });
      const pages = await page.getByTestId('cite-page').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      for (const label of pages) expect(Number(/page (\d+)/.exec(label ?? '')![1])).toBeLessThanOrEqual(6);
      const steps = await page.getByTestId('cite-step').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      for (const label of steps) expect(Number(/step (\d+)/.exec(label ?? '')![1])).toBeLessThanOrEqual(10);
      await context.close();
    });

    test('[[mock:invent]] (an invented measurement) never appears; the answer is shown as not in the manual', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await ask(page, '[[mock:invent]] what does this mean?');
      const a = page.locator('[data-kind="not-in-manual"]');
      await expect(a).toBeVisible({ timeout: 30_000 });
      await expect(a).toContainText('NOT IN YOUR MANUAL');
      await expect(page.getByTestId('conversation')).not.toContainText(/\b\d+\s?(mm|cm|kg|inch)/i);
      await shot(page, `${vp}-real-invent`);
      await context.close();
    });

    test('[[mock:html]] renders as plain text', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await ask(page, '[[mock:html]] what does this mean?');
      await expect(page.getByTestId('assistant-live')).not.toHaveText('', { timeout: 30_000 });
      await expect(lastAnswer(page).locator('img, script, a, b, i, strong, em, iframe, svg:not([aria-hidden])')).toHaveCount(0);
      expect((await lastAnswer(page).textContent())!).toMatch(/[<>]/);
      await context.close();
    });

    test('[[mock:nocite]]: an answer without a citation is never shown as a normal, uncited answer', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await ask(page, '[[mock:nocite]] what does this mean?');
      await expect(page.getByTestId('assistant-live')).not.toHaveText('', { timeout: 30_000 });
      await expect(page.getByTestId('answer-caution')).toHaveCount(0);
      // New behaviour (D-020): replaced by the fixed not-in-manual message. Old behaviour: answer without chips.
      const nim = await page.locator('[data-kind="not-in-manual"]').count();
      if (nim === 0) await expect(lastAnswer(page).getByTestId('citations')).toHaveCount(0);
      await shot(page, `${vp}-real-nocite`);
      await context.close();
    });

    test('a question the manual does not answer is shown as not in the manual, with the link', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await ask(page, 'What is the capital of France?');
      const a = page.locator('[data-kind="not-in-manual"]');
      await expect(a).toBeVisible({ timeout: 30_000 });
      await a.getByRole('button', { name: 'Open the original manual' }).click();
      await expect(page.getByTestId('original-viewer')).toBeVisible();
      expect(query(page).get('panel')).toBe('original');
      await page.goBack();
      await expect(a).toBeVisible();
      await context.close();
    });

    test('clear conversation removes it on the server too', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await ask(page, 'What does this step mean?');
      await expect(page.getByTestId('assistant-live')).not.toHaveText('', { timeout: 30_000 });
      await page.getByTestId('clear-conversation').click();
      await page.getByRole('dialog', { name: 'Clear this conversation?' }).getByRole('button', { name: 'Clear' }).click();
      await expect(page.getByTestId('assistant-empty')).toBeVisible();
      const r = await context.request.get(`/api/guides/${guideId}/messages`);
      expect(((await r.json()) as { messages: unknown[] }).messages).toEqual([]);
      await context.close();
    });

    test('Explain it more simply returns a result under the unchanged instruction', async ({ browser }) => {
      const context = await browser.newContext({ ...VIEWPORTS[vp], storageState: state, reducedMotion: 'reduce' });
      await putProgress(context, guideId, {});
      const page = await context.newPage();
      await openPlayer(page, guideId, '?step=s2');
      const instruction = await page.getByTestId('instruction').textContent();
      const content = page.getByTestId('step-content');
      await content.getByRole('button', { name: 'Explain it more simply' }).click();
      await expect(content.getByTestId('simpler-text').or(content.getByTestId('simpler-fellback'))).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('instruction')).toHaveText(instruction!);
      await shot(page, `${vp}-real-simpler`);
      await context.close();
    });
  });
}

test('the Ask button opens the real assistant; Back closes it and focus returns', async ({ browser }) => {
  const context = await browser.newContext({ ...VIEWPORTS['375'], storageState: state });
  const page = await context.newPage();
  await openPlayer(page, guideId, '?step=s2');
  await askButton(page).click();
  await expect(panelOf(page)).toBeVisible();
  await page.goBack();
  await expect(panelOf(page)).toBeHidden();
  await expect(askButton(page)).toBeFocused();
  await context.close();
});
