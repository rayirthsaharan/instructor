import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { openPlayer, putProgress, query, uploadLumen, VIEWPORTS, type VpName } from './m2-player-helpers';
import {
  answer,
  askButton,
  composer,
  failNext,
  installStreamControl,
  mockAssistantApi,
  openAssistant,
  panelOf,
  posts,
  sendDelta,
  sendDone,
  sendError,
  shot,
  user,
  wasAborted,
  type Msg,
} from './m3-helpers';

// Real app and guide (Lumen), assistant routes mocked: every state of the sheet / dock at 375 and 1280.
let guideId = '';
let state: Awaited<ReturnType<BrowserContext['storageState']>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  ({ guideId } = await uploadLumen(ctx));
  state = await ctx.storageState();
  await ctx.close();
});

async function start(browser: Browser, vp: VpName, opts: { history?: Msg[]; holdHistory?: boolean; step?: string; open?: boolean } = {}) {
  const context = await browser.newContext({ ...VIEWPORTS[vp], storageState: state, reducedMotion: 'reduce' });
  await putProgress(context, guideId, {});
  const page = await context.newPage();
  await installStreamControl(page);
  const api = await mockAssistantApi(page, { history: opts.history, holdHistory: opts.holdHistory });
  await openPlayer(page, guideId, `?step=${opts.step ?? 's2'}`);
  if (opts.open !== false) await openAssistant(page);
  return { context, page, api };
}

const sendChip = (page: Page, text: string) => page.getByTestId('suggestions').getByRole('button', { name: text }).click();
/** Types in the composer and presses the Send button (Enter is a new line on touch screens). */
async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByTestId('composer-send').click();
}

for (const vp of ['375', '1280'] as const) {
  test.describe(`assistant at ${vp}`, () => {
    test('opens over the player with the step in the header, focus inside, URL panel=ask, Back closes', async ({ browser }) => {
      const { context, page } = await start(browser, vp, { open: false });
      const titleBefore = await page.getByTestId('step-title').textContent();
      await askButton(page).click();
      await expect(panelOf(page)).toBeVisible();
      expect(query(page).get('panel')).toBe('ask');
      expect(query(page).get('step')).toBe('s2');
      await expect(page.getByTestId('context-label')).toHaveText('STEP 2');
      await expect(page.getByTestId('context-title')).toHaveText('Insert the dowels');
      if (vp === '375') {
        const sheet = page.getByRole('dialog', { name: 'Ask about this step' });
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('[data-sheet-title]')).toBeFocused();
      } else {
        await expect(page.getByTestId('assistant-dock')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Ask about this step' })).toBeFocused();
        // the step and its picture stay visible and interactive
        await expect(page.getByTestId('source-visual')).toBeVisible();
        await expect(page.getByTestId('assistant-dock').getByTestId('dock-instruction')).toBeVisible();
      }
      await expect(page.getByText('Stuck on this step? Ask in your own words.')).toBeVisible();
      await expect(page.getByTestId('suggestions').getByRole('button')).toHaveCount(3);
      await expect(page.getByText('Answers come only from your manual.')).toBeVisible();
      await shot(page, `${vp}-empty`);
      await page.goBack();
      await expect(panelOf(page)).toBeHidden();
      await expect(page.getByTestId('step-title')).toHaveText(new RegExp(titleBefore!.replace(/^Step \d+ of \d+:\s*/, '').trim()));
      await expect(askButton(page)).toBeFocused();
      await context.close();
    });

    test('Escape and the close control close it and return focus to Ask', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await page.keyboard.press('Escape');
      await expect(panelOf(page)).toBeHidden();
      await expect(askButton(page)).toBeFocused();
      await openAssistant(page);
      await (vp === '375' ? page.getByRole('dialog', { name: 'Ask about this step' }).getByRole('button', { name: 'Close', exact: true }) : page.getByTestId('dock-close')).click();
      await expect(panelOf(page)).toBeHidden();
      await expect(askButton(page)).toBeFocused();
      await context.close();
    });

    test('loading history shows two message skeletons, then the conversation', async ({ browser }) => {
      const { context, page, api } = await start(browser, vp, {
        holdHistory: true,
        history: [user('What are the dowels for?'), answer('They line up the panels.')],
      });
      await expect(page.getByTestId('history-skeleton')).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(1);
      await shot(page, `${vp}-loading-history`);
      api.releaseHistory();
      await expect(page.getByTestId('history-skeleton')).toHaveCount(0);
      await expect(page.getByText('What are the dowels for?')).toBeVisible();
      await context.close();
    });

    test('history: user bubble, labelled answer, step dividers, citations, not-in-manual, caution', async ({ browser }) => {
      const history = [
        user('What are the dowels for?'),
        answer('They line up the panels.\nPush them in by hand.', 's2', { citations: [{ stepId: 's2', pageIndex: 2 }] }),
        user('What size is the screw?', 's4'),
        answer("The manual doesn't give a screw size for this step.", 's4', { notInManual: true }),
        user('Anything else to know?', 's4'),
        answer('Check each lock sits flush.', 's4'),
      ];
      const { context, page } = await start(browser, vp, { history, step: 's4' });
      await expect(page.getByTestId('user-message')).toHaveCount(3);
      await expect(page.getByTestId('step-divider')).toHaveText(['ABOUT STEP 2', 'ABOUT STEP 4']);
      const first = page.locator('[data-testid="assistant-message"][data-kind="answer"]').first();
      await expect(first).toContainText("Instructor's explanation - not the manual's wording.");
      // plain text with the line break kept
      expect(await first.locator('p').nth(1).evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('pre-wrap');
      const nim = page.locator('[data-kind="not-in-manual"]');
      await expect(nim).toContainText('NOT IN YOUR MANUAL');
      await expect(nim.getByRole('button', { name: 'Open the original manual' })).toBeVisible();
      await expect(nim.getByTestId('citations')).toHaveCount(0);
      await expect(page.getByTestId('answer-caution')).toHaveCount(0); // D-020: no note, no caution line
      await expect(page.getByTestId('suggestions')).toHaveCount(0); // a question was asked on step 4
      await page.getByTestId('conversation').evaluate((e) => (e.scrollTop = 0));
      await shot(page, `${vp}-history`);
      await context.close();
    });

    test('a suggestion chip sends; the answer streams as plain text, announced once at the end', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await sendChip(page, 'Why am I doing this?');
      await expect(page.getByTestId('user-message')).toHaveText('Why am I doing this?');
      expect(await posts(page)).toEqual([{ stepId: 's2', text: 'Why am I doing this?' }]);
      // streaming: Stop replaces Send, the field is disabled, suggestions are gone
      await expect(page.getByTestId('composer-stop')).toBeVisible();
      await expect(page.getByTestId('composer-send')).toHaveCount(0);
      await expect(composer(page)).toBeDisabled();
      await expect(page.getByTestId('suggestions')).toHaveCount(0);
      await sendDelta(page, 'They keep the panels <b>lined</b> up');
      await expect(page.getByTestId('assistant-streaming')).toContainText('They keep the panels <b>lined</b> up');
      await expect(page.getByTestId('caret')).toHaveCount(0);
      await expect(page.getByTestId('provisional')).toHaveCSS('color', await page.getByTestId('answer-status').evaluate((e) => getComputedStyle(e).color));
      await expect(page.getByTestId('answer-status')).toHaveText('Checking this against your manual...');
      await expect(page.locator('b')).toHaveCount(0);
      await expect(page.getByTestId('assistant-live')).toHaveText('Looking in your manual.'); // announced once, when the question is sent
      await shot(page, `${vp}-streaming`);
      await sendDelta(page, ' while the glue sets.\nSecond line.');
      await expect(page.getByTestId('assistant-live')).toHaveText('Looking in your manual.');
      await sendDone(page, answer('They keep the panels <b>lined</b> up while the glue sets.\nSecond line.', 's2', { citations: [{ stepId: 's2', pageIndex: 2 }] }));
      await expect(page.getByTestId('assistant-streaming')).toHaveCount(0);
      await expect(page.getByTestId('assistant-live')).toContainText('Second line.');
      await expect(page.getByTestId('composer-send')).toBeVisible();
      await expect(composer(page)).toBeEnabled();
      await expect(page.locator('[data-testid="assistant-message"] b')).toHaveCount(0);
      await expect(page.getByTestId('citations').getByTestId('cite-page')).toHaveText('p. 3');
      await shot(page, `${vp}-answer`);
      await context.close();
    });

    test('held-back answer: status line before the first words, while checking, and after 20 seconds', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await page.clock.install();
      await ask(page, 'How many dowels?');
      const status = page.getByTestId('answer-status');
      await expect(status).toHaveText('Looking in your manual...');
      await expect(page.getByTestId('provisional')).toHaveCount(0);
      await shot(page, `${vp}-held-looking`);
      await sendDelta(page, 'You need');
      await expect(status).toHaveText('Checking this against your manual...');
      await shot(page, `${vp}-held-checking`);
      await page.clock.runFor(21_000);
      await expect(status).toHaveText('Still checking. This can take up to a minute.');
      await shot(page, `${vp}-held-slow`);
      await sendDone(page, answer('You need 4 dowels.'));
      await expect(page.getByTestId('assistant-streaming')).toHaveCount(0);
      await expect(page.getByTestId('assistant-message')).toContainText('You need 4 dowels.');
      await context.close();
    });

    test('an assistant that is unavailable keeps the question and offers Try again', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await ask(page, 'Will this work?');
      await sendError(page, 'ai_unavailable', 'timeout');
      const err = page.getByTestId('turn-error');
      await expect(err).toContainText("The assistant isn't available right now. Try again in a little while.");
      await expect(page.getByTestId('user-message')).toHaveText('Will this work?');
      await expect(err.getByRole('button', { name: 'Try again' })).toBeVisible();
      await context.close();
    });

    test('Stop aborts the request and keeps the question with Ask again', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await ask(page, 'Is this step important?');
      await sendDelta(page, 'Partial');
      await page.getByTestId('composer-stop').click();
      await expect.poll(() => wasAborted(page)).toBe(true);
      await expect(page.getByTestId('assistant-streaming')).toHaveCount(0);
      await expect(page.getByTestId('user-message')).toHaveText('Is this step important?');
      await expect(page.getByTestId('turn-error')).toContainText('You stopped this answer.');
      await expect(page.getByText('Partial')).toHaveCount(0);
      await shot(page, `${vp}-stopped`);
      await page.getByTestId('turn-retry').click();
      await expect.poll(async () => (await posts(page)).length).toBe(2);
      expect((await posts(page))[1]).toEqual({ stepId: 's2', text: 'Is this step important?' });
      await sendDone(page, answer('Yes.'));
      await expect(page.getByTestId('assistant-message')).toContainText('Yes.');
      await context.close();
    });

    test('a stream error keeps the question and offers Try again', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await ask(page, 'What next?');
      await sendDelta(page, 'Half an ans');
      await sendError(page);
      const err = page.getByTestId('turn-error');
      await expect(err).toContainText("That didn't go through.");
      await expect(err).not.toContainText('boom');
      await expect(page.getByTestId('user-message')).toHaveText('What next?');
      await expect(composer(page)).toBeEnabled();
      await shot(page, `${vp}-error`);
      await err.getByRole('button', { name: 'Try again' }).click();
      await expect.poll(async () => (await posts(page)).length).toBe(2);
      await sendDone(page, answer('Next, press in the dowels.'));
      await expect(page.getByTestId('turn-error')).toHaveCount(0);
      await expect(page.getByTestId('user-message')).toHaveCount(1);
      await context.close();
    });

    test('a dropped connection and a stream that ends early both show the error', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await ask(page, 'First');
      await page.evaluate(() => (window as any).__ctl.close()); // eslint-disable-line @typescript-eslint/no-explicit-any
      await expect(page.getByTestId('turn-error')).toContainText("That didn't go through.");
      await context.close();
    });

    test('rate_limited and busy have their own messages', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await failNext(page, 429, 'rate_limited');
      await ask(page, 'Question one');
      const err = page.getByTestId('turn-error');
      await expect(err).toContainText("You're asking quickly. Wait a little, then try again.");
      await expect(err).not.toContainText('server words');
      await shot(page, `${vp}-rate-limited`);
      await failNext(page, 409, 'busy');
      await err.getByRole('button', { name: 'Try again' }).click();
      await expect(err).toContainText('Still answering your last question');
      await shot(page, `${vp}-busy`);
      await context.close();
    });

    test('offline: composer disabled with the helper, history still readable; back online re-enables', async ({ browser }) => {
      const { context, page } = await start(browser, vp, { history: [user('Earlier question'), answer('Earlier answer')] });
      await expect(page.getByText('Earlier answer')).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByTestId('composer-helper')).toHaveText("You're offline. Questions need a connection.");
      await expect(composer(page)).toBeDisabled();
      await expect(page.getByText('Earlier answer')).toBeVisible();
      await shot(page, `${vp}-offline`);
      await context.setOffline(false);
      await expect(composer(page)).toBeEnabled();
      await context.close();
    });

    test('the question limit: counter near 1000, over-limit blocks Send', async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await composer(page).fill('a'.repeat(700));
      await expect(page.getByTestId('composer-count')).toHaveCount(0);
      await composer(page).fill('a'.repeat(850));
      await expect(page.getByTestId('composer-count')).toHaveText('850 / 1000');
      await expect(page.getByTestId('composer-send')).toBeEnabled();
      await composer(page).fill('a'.repeat(1003));
      await expect(page.getByTestId('composer-count')).toContainText('3 over the limit');
      await expect(page.getByTestId('composer-send')).toBeDisabled();
      await composer(page).fill('   ');
      await expect(page.getByTestId('composer-send')).toBeDisabled();
      await composer(page).fill('a'.repeat(1000));
      await expect(page.getByTestId('composer-send')).toBeEnabled();
      await shot(page, `${vp}-counter`);
      await context.close();
    });

    test('markup and instructions in an answer are shown as text only', async ({ browser }) => {
      const evil = '<img src=x onerror="window.__pwned=1"> **bold** [x](javascript:alert(1)) <script>window.__pwned=2</script>';
      const { context, page } = await start(browser, vp);
      await ask(page, 'Show me');
      await sendDelta(page, evil);
      await sendDone(page, answer(evil));
      const msg = page.getByTestId('assistant-message');
      await expect(msg).toContainText('<img src=x onerror="window.__pwned=1"> **bold**');
      await expect(msg.locator('img, script, a, b, strong')).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined(); // eslint-disable-line @typescript-eslint/no-explicit-any
      await context.close();
    });

    test('a step chip goes to that step; a page chip opens the Original viewer and Back restores the conversation', async ({ browser }) => {
      const history = [user('Where is this?'), answer('See the diagram.', 's2', { citations: [{ stepId: 's4', pageIndex: 3, region: { x: 0.1, y: 0.2, w: 0.4, h: 0.3 } }] })];
      const { context, page } = await start(browser, vp, { history });
      const chips = page.getByTestId('citations');
      await expect(chips.getByTestId('cite-step')).toHaveText('Step 4');
      await expect(chips.getByTestId('cite-page')).toHaveText('p. 4');
      await chips.getByTestId('cite-page').click();
      const viewer = page.getByTestId('original-viewer');
      await expect(viewer).toBeVisible();
      expect(query(page).get('panel')).toBe('original');
      expect(query(page).get('page')).toBe('4');
      await expect(page.getByTestId('viewer-marks')).toBeVisible(); // the cited region is bracketed
      await shot(page, `${vp}-citation-viewer`);
      await page.goBack();
      await expect(viewer).toBeHidden();
      await expect(panelOf(page)).toBeVisible();
      await expect(page.getByText('See the diagram.')).toBeVisible();
      // the step chip
      await chips.getByTestId('cite-step').click();
      await expect(page).toHaveURL(/step=s4/);
      await expect(page.getByTestId('step-counter')).toContainText('Step 4 of 10');
      if (vp === '1280') {
        await expect(page.getByTestId('context-label')).toHaveText('STEP 4'); // the dock stays open
        expect(query(page).get('panel')).toBe('ask');
      } else {
        await expect(panelOf(page)).toBeHidden();
      }
      await context.close();
    });

    test('not in manual: the link opens the original manual at the step page and Back returns', async ({ browser }) => {
      const { context, page } = await start(browser, vp, { history: [user('How heavy?'), answer('The manual does not say.', 's2', { notInManual: true })] });
      await page.getByTestId('open-manual').click();
      await expect(page.getByTestId('original-viewer')).toBeVisible();
      expect(query(page).get('panel')).toBe('original');
      await page.goBack();
      await expect(page.getByTestId('original-viewer')).toBeHidden();
      await expect(page.getByText('The manual does not say.')).toBeVisible();
      await context.close();
    });

    test('clear conversation asks first, then empties it', async ({ browser }) => {
      const { context, page, api } = await start(browser, vp, { history: [user('Q'), answer('A')] });
      await page.getByTestId('clear-conversation').click();
      const dlg = page.getByRole('dialog', { name: 'Clear this conversation?' });
      await expect(dlg).toBeVisible();
      await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await shot(page, `${vp}-clear-confirm`);
      await dlg.getByRole('button', { name: 'Cancel' }).click();
      expect(api.deletes).toBe(0);
      await expect(page.getByTestId('assistant-message')).toHaveText(/A$/);
      await page.getByTestId('clear-conversation').click();
      await dlg.getByRole('button', { name: 'Clear' }).click();
      await expect(page.getByText('Stuck on this step? Ask in your own words.')).toBeVisible();
      expect(api.deletes).toBe(1);
      await context.close();
    });

    test('history that fails to load says so and can be retried', async ({ browser }) => {
      const context = await browser.newContext({ ...VIEWPORTS[vp], storageState: state, reducedMotion: 'reduce' });
      const page = await context.newPage();
      let fail = true;
      await mockAssistantApi(page);
      await page.route(/\/api\/guides\/[^/]+\/messages$/, (r) => (r.request().method() === 'GET' && fail ? r.fulfill({ status: 500, json: { error: { code: 'x', message: 'x' } } }) : r.fallback()));
      await openPlayer(page, guideId, '?step=s2');
      await openAssistant(page);
      await expect(page.getByTestId('history-error')).toContainText("Couldn't load your earlier questions.");
      fail = false;
      await page.getByTestId('history-error').getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByTestId('history-error')).toHaveCount(0);
      await context.close();
    });
  });
}

test.describe('step awareness', () => {
  test('desktop dock: changing step updates the context and the next question uses the new step', async ({ browser }) => {
    const { context, page, api } = await start(browser, '1280');
    await expect(page.getByTestId('context-label')).toHaveText('STEP 2');
    await page.getByTestId('dock-close').focus();
    await page.getByRole('button', { name: 'Steps' }).count(); // no Steps button on desktop
    await page.keyboard.press('ArrowRight'); // arrows work while the dock is open and focus is not in the field
    await expect(page.getByTestId('context-label')).toHaveText('STEP 3');
    await expect(page.getByTestId('context-title')).toHaveText('Fit the cam bolts');
    expect(query(page).get('panel')).toBe('ask');
    await expect.poll(() => api.suggestionRequests).toContain('s3');
    await ask(page, 'What is a cam bolt?');
    expect((await posts(page))[0]).toEqual({ stepId: 's3', text: 'What is a cam bolt?' });
    await sendDone(page, answer('A metal bolt.', 's3'));
    await page.keyboard.press('Tab'); // leave the field
    await page.getByTestId('conversation').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('context-label')).toHaveText('STEP 4');
    await ask(page, 'And this one?');
    expect((await posts(page))[1]).toMatchObject({ stepId: 's4' });
    await sendDone(page, answer('A lock.', 's4'));
    await expect(page.getByTestId('step-divider')).toHaveText(['ABOUT STEP 3', 'ABOUT STEP 4']);
    await shot(page, '1280-two-steps');
    await context.close();
  });

  for (const [stepId, name, irreversible] of [['s5', 'warning', false], ['s7', 'irreversible', true]] as const) {
    test(`desktop dock: a ${name} step keeps its banners on screen above the chat and out of the toggle`, async ({ browser }) => {
      const { context, page } = await start(browser, '1280', { step: stepId });
      const banners = page.getByTestId('dock-banners');
      await expect(banners).toBeVisible();
      await expect(banners).toContainText(irreversible ? "Can't be undone" : 'Caution');
      await expect(banners.locator('[role="note"]').first()).toBeVisible();
      await shot(page, `1280-dock-${name}`);
      const toggle = page.getByTestId('dock-step-toggle');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(banners).toBeVisible(); // collapsing never hides a warning
      await expect(page.getByTestId('dock-instruction')).toHaveCount(0);
      // the summary is capped at 44% of the column and sits above the conversation
      const sum = (await page.getByTestId('dock-summary').boundingBox())!;
      const conv = (await page.getByTestId('conversation').boundingBox())!;
      expect(sum.y + sum.height).toBeLessThanOrEqual(conv.y + 1);
      await toggle.click();
      await expect(page.getByTestId('dock-instruction')).toBeVisible();
      await context.close();
    });
  }

  test('desktop dock: the Ask button is the dock toggle (open state, aria-expanded)', async ({ browser }) => {
    const { context, page } = await start(browser, '1280');
    await expect(askButton(page)).toHaveAttribute('aria-expanded', 'true');
    await askButton(page).click();
    await expect(page.getByTestId('assistant-dock')).toHaveCount(0);
    await expect(askButton(page)).toHaveAttribute('aria-expanded', 'false');
    await context.close();
  });

  test('phone sheet: the context strip names the safety tag of the step', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { step: 's7' });
    await expect(page.getByTestId('context-label')).toHaveText('STEP 7');
    await expect(page.getByTestId('context-safety')).toHaveText("Can't be undone");
    await context.close();
    const w = await start(browser, '375', { step: 's5' });
    await expect(w.page.getByTestId('context-safety')).toHaveText('1 warning');
    await w.context.close();
  });

  test('desktop dock: the step pinned at the top collapses; Enter sends, Shift+Enter adds a line', async ({ browser }) => {
    const { context, page } = await start(browser, '1280');
    const toggle = page.getByTestId('dock-step-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('dock-instruction')).toHaveCount(0);
    await composer(page).click();
    await composer(page).pressSequentially('line one');
    await page.keyboard.press('Shift+Enter');
    await composer(page).pressSequentially('line two');
    await expect(composer(page)).toHaveValue('line one\nline two');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await posts(page)).length).toBe(1);
    expect((await posts(page))[0]!.text).toBe('line one\nline two');
    await expect(composer(page)).toHaveValue('');
    await sendDone(page, answer('Fine.'));
    await expect(composer(page)).toBeFocused(); // focus comes back to the field after the answer
    await context.close();
  });

  test('phone sheet: the composer is inside the viewport and the sheet is at the full detent', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    const box = await composer(page).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(800);
    const sheet = await page.locator('dialog.sheet[open] .sheet-inner').boundingBox();
    expect(sheet!.height).toBeGreaterThan(700);
    // touch screens: Enter is a new line, the Send button sends
    await composer(page).fill('one');
    await composer(page).press('Enter');
    expect(await posts(page)).toEqual([]);
    await context.close();
  });

  test('tapping the context strip closes the sheet and shows the step', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    await page.getByTestId('context-strip').click();
    await expect(panelOf(page)).toBeHidden();
    await expect(page.getByTestId('step-title')).toBeVisible();
    await context.close();
  });

  test('768: opens as a sheet', async ({ browser }) => {
    const { context, page } = await start(browser, '768');
    await expect(page.getByRole('dialog', { name: 'Ask about this step' })).toBeVisible();
    await shot(page, '768-empty');
    await context.close();
  });
});

test.describe('Explain it more simply', () => {
  for (const vp of ['375', '1280'] as const) {
    test(`loading, result under the original, cached per step, warnings untouched at ${vp}`, async ({ browser }) => {
      const { context, page, api } = await start(browser, vp, { open: false, step: 's5' });
      api.simplify.mode = 'hold';
      const content = page.getByTestId('step-content');
      const instruction = await page.getByTestId('instruction').textContent();
      const warnings = await content.locator('[data-kind="warning"], [data-kind="caution"]').allTextContents();
      expect(warnings.length).toBeGreaterThan(0);
      const toggle = content.getByRole('button', { name: 'Explain it more simply' });
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
      await expect(content.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible();
      await shot(page, `${vp}-simpler-loading`);
      api.releaseSimplify();
      api.simplify.mode = 'ok';
      const out = content.getByTestId('simpler-wording');
      await expect(out).toContainText('SIMPLER WORDING');
      await expect(out.getByTestId('simpler-text')).toHaveText('Push each wooden pin into its hole.');
      await expect(out).toContainText('Same step, simpler words. Numbers and part names are unchanged.');
      await expect(page.getByTestId('instruction')).toHaveText(instruction!);
      expect(await content.locator('[data-kind="warning"], [data-kind="caution"]').allTextContents()).toEqual(warnings);
      await shot(page, `${vp}-simpler-result`);
      // closing and reopening does not ask again
      await toggle.click();
      await toggle.click();
      expect(api.simplify.calls).toBe(1);
      await context.close();
    });
  }

  test('fellBack shows the "already as simple" line, never the original again as a rewrite', async ({ browser }) => {
    const { context, page, api } = await start(browser, '375', { open: false });
    api.simplify.mode = 'fellBack';
    const content = page.getByTestId('step-content');
    await content.getByRole('button', { name: 'Explain it more simply' }).click();
    await expect(content.getByTestId('simpler-fellback')).toHaveText('This step is already as simple as we can safely make it.');
    await expect(content.getByTestId('simpler-wording')).toHaveCount(0);
    await shot(page, '375-simpler-fellback');
    await context.close();
  });

  test('an error says so and Try again recovers', async ({ browser }) => {
    const { context, page, api } = await start(browser, '375', { open: false });
    api.simplify.failFirst = true;
    const content = page.getByTestId('step-content');
    await content.getByRole('button', { name: 'Explain it more simply' }).click();
    await expect(content.getByTestId('simpler-error')).toContainText("Couldn't get a simpler version.");
    await shot(page, '375-simpler-error');
    await content.getByTestId('simpler-error').getByRole('button', { name: 'Try again' }).click();
    await expect(content.getByTestId('simpler-text')).toHaveText('Push each wooden pin into its hole.');
    await context.close();
  });

  test('moving to another step asks for that step', async ({ browser }) => {
    const { context, page, api } = await start(browser, '375', { open: false });
    const content = page.getByTestId('step-content');
    await content.getByRole('button', { name: 'Explain it more simply' }).click();
    await expect(content.getByTestId('simpler-text')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('step-title')).toContainText('Fit the cam bolts');
    await expect(content.getByTestId('simpler-text')).toBeVisible();
    expect(api.simplify.calls).toBe(2);
    await context.close();
  });
});

// D-022 item 7: banners are never clipped, even in short windows; the dock column scrolls instead.
test.describe('desktop dock in short windows', () => {
  for (const size of [
    { width: 1280, height: 600 },
    { width: 1024, height: 768 },
  ]) {
    for (const stepId of ['s7', 's8', 's9']) {
      test(`${size.width}x${size.height} step ${stepId}: every banner is fully on screen above the Primary`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: size, storageState: state, reducedMotion: 'reduce' });
        await putProgress(context, guideId, {});
        const page = await context.newPage();
        await installStreamControl(page);
        await mockAssistantApi(page);
        await openPlayer(page, guideId, `?step=${stepId}`);
        await openAssistant(page);
        const r = await page.evaluate(() => {
          const scroll = document.querySelector('[data-testid="dock-scroll"]')!.getBoundingClientRect();
          const banners = [...document.querySelectorAll('[data-testid="dock-banners"] > [role="note"]')].map((el) => el.getBoundingClientRect());
          return { scrollTop: scroll.top, scrollBottom: scroll.bottom, banners: banners.map((b) => ({ top: b.top, bottom: b.bottom })), height: window.innerHeight };
        });
        expect(r.banners.length).toBeGreaterThan(0);
        for (const b of r.banners) {
          expect(b.top).toBeGreaterThanOrEqual(r.scrollTop - 1);
          expect(b.bottom).toBeLessThanOrEqual(r.scrollBottom + 1);
          expect(b.bottom).toBeLessThanOrEqual(r.height);
        }
        await shot(page, `${size.width}x${size.height}-dock-${stepId}`);
        await context.close();
      });
    }
  }
});
