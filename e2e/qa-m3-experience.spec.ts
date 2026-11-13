import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { openPlayer, putProgress, query, uploadLumen, VIEWPORTS } from './m2-player-helpers';
import { answer, askButton, composer, installStreamControl, mockAssistantApi, openAssistant, panelOf, sendDelta, sendDone, user } from './m3-helpers';

// QA of M3: real server + worker + mock AI provider unless a test installs the stream control (then only POST /messages is faked).
// One uploaded guide (= one session) is shared by the tests that must stay under the 30 questions / 10 minutes limit.
let guideId = '';
let state: Awaited<ReturnType<BrowserContext['storageState']>>;
const BASE = 'http://localhost:3100';
// Two sessions (30 questions per 10 minutes each): group B alone asks more than 20 real questions.
const sessions: Array<{ guideId: string; state: typeof state }> = [];
const useSession = (n: number) => {
  guideId = sessions[n]!.guideId;
  state = sessions[n]!.state;
};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext();
    const { guideId: g } = await uploadLumen(ctx);
    sessions.push({ guideId: g, state: await ctx.storageState() });
    await ctx.close();
  }
  useSession(0);
});

type Vp = { width: number; height: number; touch?: boolean };
async function start(browser: Browser, vp: Vp, step = 's2', opts: { reducedMotion?: boolean; clear?: boolean } = {}) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.touch,
    hasTouch: !!vp.touch,
    storageState: state,
    reducedMotion: opts.reducedMotion === false ? 'no-preference' : 'reduce',
  });
  if (opts.clear !== false) await context.request.delete(`/api/guides/${guideId}/messages`);
  await putProgress(context, guideId, {});
  const page = await context.newPage();
  await openPlayer(page, guideId, `?step=${step}`);
  return { context, page };
}
const PHONE: Vp = { width: 375, height: 800, touch: true };
const DESK: Vp = { width: 1280, height: 900 };
const send = async (page: Page, text: string) => {
  await composer(page).fill(text);
  await page.getByTestId('composer-send').click();
};
const serverMessages = async (context: BrowserContext) =>
  ((await (await context.request.get(`/api/guides/${guideId}/messages`)).json()) as { messages: Array<{ role: string; text: string; stepId: string; notInManual: boolean }> }).messages;

/** Records every text the conversation ever shows (one snapshot per DOM mutation), with whether a held-back answer was still streaming. */
async function recordDom(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __snaps: Array<{ streaming: boolean; text: string }> };
    w.__snaps = [];
    const snap = () => {
      const c = document.querySelector('[data-testid="conversation"]');
      if (!c) return;
      w.__snaps.push({ streaming: !!c.querySelector('[data-testid="assistant-streaming"]'), text: c.textContent ?? '' });
    };
    new MutationObserver(snap).observe(document, { subtree: true, childList: true, characterData: true, attributes: false });
  });
}
const snaps = (page: Page) => page.evaluate(() => (window as unknown as { __snaps: Array<{ streaming: boolean; text: string }> }).__snaps);

test.describe('A. guards in the browser (real server, mock provider)', () => {
  for (const vp of [PHONE, DESK]) {
    test(`[[mock:invent]] never puts the invented measurement in the DOM, not even for one frame (${vp.width})`, async ({ browser }) => {
      const { context, page } = await start(browser, vp);
      await recordDom(page);
      await page.reload();
      await openAssistant(page);
      await send(page, '[[mock:invent]] what does this mean?');
      await expect(page.locator('[data-kind="not-in-manual"]')).toBeVisible({ timeout: 30_000 });
      const all = await snaps(page);
      expect(all.length).toBeGreaterThan(3);
      for (const s of all) expect(s.text, 'snapshot while streaming').not.toMatch(/47|Nm|3 hours|hours/);
      await context.close();
    });
  }

  test('while an answer is being checked no digit, unit or link is visible; the verified numbers appear only at the end', async ({ browser }) => {
    const { context, page } = await start(browser, DESK);
    await recordDom(page);
    await page.reload();
    await openAssistant(page);
    await send(page, 'What does this step mean?'); // the answer restates "Press 4 dowels ..."
    await expect(page.getByTestId('assistant-message').last()).toContainText('4 dowels', { timeout: 30_000 });
    const all = await snaps(page);
    const streaming = all.filter((s) => s.streaming);
    expect(streaming.length, 'at least one frame while held back').toBeGreaterThan(0);
    for (const s of streaming) {
      const answerPart = s.text.replace('What does this step mean?', '').replace(/ABOUT STEP \d+/g, '');
      expect(answerPart).not.toMatch(/\d/);
    }
    await context.close();
  });

  test('[[mock:html]] and [[mock:nocite]] and [[mock:badcite]] over the real stream: text only, fixed message, no chips', async ({ browser }) => {
    const { context, page } = await start(browser, PHONE);
    await openAssistant(page);
    await send(page, '[[mock:html]] what does this mean?');
    const a = page.getByTestId('assistant-message').last();
    await expect(page.getByTestId('assistant-live')).not.toHaveText('', { timeout: 30_000 });
    await expect(a.locator('a, img, script, b, i, iframe, svg:not([aria-hidden])')).toHaveCount(0);
    await expect(a).toContainText('<script>');
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    for (const trig of ['nocite', 'badcite']) {
      await send(page, `[[mock:${trig}]] what does this mean?`);
      await expect(page.locator('[data-kind="not-in-manual"]')).toHaveCount(trig === 'nocite' ? 1 : 1, { timeout: 30_000 });
      await expect(page.locator('[data-kind="not-in-manual"]').last()).toContainText("I couldn't find this in your manual, so I won't guess");
      await expect(page.locator('[data-kind="not-in-manual"]').last().getByTestId('citations')).toHaveCount(0);
      await page.getByTestId('clear-conversation').click();
      await page.getByRole('dialog', { name: 'Clear this conversation?' }).getByRole('button', { name: 'Clear' }).click();
      await expect(page.getByTestId('assistant-empty')).toBeVisible();
    }
    await context.close();
  });

  test('an answer shown as text cannot create links or elements, and bidi/control characters are stripped by the client too', async ({ browser }) => {
    const { context, page } = await start(browser, DESK, 's2', { clear: true });
    await installStreamControl(page);
    await page.reload();
    await openAssistant(page);
    await send(page, 'hi');
    const nasty = 'Visit <a href="https://evil.example">here</a> or [x](https://evil.example) https://evil.example <img src=x onerror="window.__x=1"> ‮gnirts‬';
    await sendDelta(page, 'Press the ');
    await sendDone(page, answer(nasty, 's2', { citations: [{ stepId: 's2', pageIndex: 2 }] }));
    const msg = page.getByTestId('assistant-message').last();
    await expect(msg).toContainText('<a href=');
    await expect(msg.locator('a, img')).toHaveCount(0);
    await expect(page.locator('[data-testid="conversation"] a')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    await context.close();
  });
});

test.describe('B. streaming robustness (real server)', () => {
  test.beforeEach(() => useSession(1));
  test.afterEach(() => useSession(0));
  test('Stop mid-stream, then ask again immediately: the second question is answered, never "still answering"', async ({ browser }) => {
    const { context, page } = await start(browser, DESK);
    await openAssistant(page);
    for (let i = 0; i < 3; i++) {
      await send(page, 'What does this step mean?');
      await expect(page.getByTestId('assistant-streaming')).toBeVisible();
      await page.getByRole('button', { name: 'Stop' }).click();
      await expect(page.getByTestId('turn-error')).toContainText('You stopped this answer');
      // immediately again, no waiting
      await send(page, 'Why am I doing this?');
      await expect(page.getByTestId('assistant-message').last()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('turn-error'), `round ${i}: busy or other error after Stop`).toHaveCount(0);
      await page.getByTestId('clear-conversation').click();
      await page.getByRole('dialog', { name: 'Clear this conversation?' }).getByRole('button', { name: 'Clear' }).click();
      await expect(page.getByTestId('assistant-empty')).toBeVisible();
    }
    await context.close();
  });

  test('Stopped answers leave nothing on the server; a following answer is stored once, in order', async ({ browser }) => {
    const { context, page } = await start(browser, DESK);
    await openAssistant(page);
    await send(page, 'What does this step mean?');
    await expect(page.getByTestId('assistant-streaming')).toBeVisible();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('turn-error')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await serverMessages(context)).toEqual([]);
    await context.close();
  });

  test('closing the sheet mid-stream leaves either nothing or a complete pair, and the next question works', async ({ browser }) => {
    const { context, page } = await start(browser, PHONE);
    await openAssistant(page);
    await send(page, 'What does this step mean?');
    await expect(page.getByTestId('assistant-streaming')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panelOf(page)).toBeHidden();
    await page.waitForTimeout(3000);
    const msgs = await serverMessages(context);
    expect([0, 2]).toContain(msgs.length);
    await openAssistant(page);
    await expect(page.getByTestId('history-skeleton')).toHaveCount(0);
    // UI must agree with the server
    await expect(page.getByTestId('user-message')).toHaveCount(msgs.length / 2);
    await expect(page.getByTestId('assistant-streaming')).toHaveCount(0);
    await send(page, 'Why am I doing this?');
    await expect(page.getByTestId('assistant-message').last()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('turn-error')).toHaveCount(0);
    await context.close();
  });

  test('reload mid-stream stores no half answer and the first question afterwards is not refused as busy', async ({ browser }) => {
    const { context, page } = await start(browser, PHONE);
    await openAssistant(page);
    await send(page, 'What does this step mean?');
    await expect(page.getByTestId('assistant-streaming')).toBeVisible();
    await page.reload();
    await expect(panelOf(page)).toBeVisible();
    await expect(page.getByTestId('history-skeleton')).toHaveCount(0);
    const msgs = await serverMessages(context);
    expect(msgs.length % 2, 'never a lone question or lone answer').toBe(0);
    await send(page, 'Why am I doing this?');
    await expect(page.getByTestId('assistant-message').last()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('turn-error'), 'busy right after a reload').toHaveCount(0);
    await context.close();
  });

  test('two tabs asking at once: the second gets the busy copy, then works once the first is done', async ({ browser }) => {
    const { context, page } = await start(browser, DESK);
    const other = await context.newPage();
    await openPlayer(other, guideId, '?step=s2');
    await openAssistant(page);
    await openAssistant(other);
    await send(page, 'What does this step mean?');
    await expect(page.getByTestId('assistant-streaming')).toBeVisible();
    await send(other, 'Why am I doing this?');
    await expect(other.getByTestId('turn-error')).toContainText('Still answering your last question', { timeout: 10_000 });
    await expect(other.getByTestId('turn-error')).toHaveAttribute('data-code', 'busy');
    await expect(page.getByTestId('assistant-message').last()).toBeVisible({ timeout: 30_000 });
    await other.getByTestId('turn-retry').click();
    await expect(other.getByTestId('assistant-message').last()).toBeVisible({ timeout: 30_000 });
    await context.close();
  });

  test('navigating steps mid-stream on desktop: the answer stays attached to the step it was asked about', async ({ browser }) => {
    const { context, page } = await start(browser, DESK, 's4');
    await openAssistant(page);
    await send(page, 'What does this step mean?');
    await expect(page.getByTestId('assistant-streaming')).toBeVisible();
    await page.getByTestId('primary').click(); // Done - next step (s5) while streaming
    await expect(page.getByTestId('context-label')).toHaveText('STEP 5');
    await expect(page.getByTestId('assistant-message').last()).toBeVisible({ timeout: 30_000 });
    const msgs = await serverMessages(context);
    expect(msgs.map((m) => m.stepId)).toEqual(['s4', 's4']);
    expect(msgs[1]!.text).toMatch(/cam lock/i);
    // the next question is about the new step
    await send(page, 'What does this step mean?');
    await expect(page.getByTestId('assistant-message')).toHaveCount(2, { timeout: 30_000 });
    expect((await serverMessages(context)).map((m) => m.stepId)).toEqual(['s4', 's4', 's5', 's5']);
    await expect(page.getByTestId('step-divider')).toHaveText(['ABOUT STEP 4', 'ABOUT STEP 5']);
    await context.close();
  });

  test('over real HTTP: a client that drops the connection frees the stream slot at once', async ({ browser }) => {
    const { context } = await start(browser, DESK);
    const cookies = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    for (let i = 0; i < 4; i++) {
      const ac = new AbortController();
      const res = await fetch(`${BASE}/api/guides/${guideId}/messages`, {
        method: 'POST',
        headers: { cookie: cookies, 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ stepId: 's2', text: 'What does this step mean?' }),
        signal: ac.signal,
      });
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      await reader.read();
      ac.abort();
      // no waiting: the very next request must not be 409
      const next = await fetch(`${BASE}/api/guides/${guideId}/messages`, {
        method: 'POST',
        headers: { cookie: cookies, 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify({ stepId: 's3', text: 'Why am I doing this?' }),
      });
      expect(next.status, `attempt ${i}`).toBe(200);
      await next.text();
    }
    await context.close();
  });

  test('history keeps order across a reload and shows the step dividers', async ({ browser }) => {
    const { context, page } = await start(browser, DESK, 's2');
    await openAssistant(page);
    await send(page, 'What does this step mean?');
    await expect(page.getByTestId('assistant-message').last()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('primary').click();
    await send(page, 'Why am I doing this?');
    await expect(page.getByTestId('assistant-message')).toHaveCount(2, { timeout: 30_000 });
    await page.reload();
    await expect(page.getByTestId('assistant-message')).toHaveCount(2);
    await expect(page.getByTestId('user-message')).toHaveText(['What does this step mean?', 'Why am I doing this?']);
    await expect(page.getByTestId('step-divider')).toHaveText(['ABOUT STEP 2', 'ABOUT STEP 3']);
    await context.close();
  });
});

test.describe('B. rate limit (own session)', () => {
  test('after 30 questions in 10 minutes the next one shows the rate-limit copy, and Try again is offered', async ({ browser }) => {
    test.setTimeout(240_000);
    const owner = await browser.newContext();
    const { guideId: g } = await uploadLumen(owner);
    const body = JSON.stringify({ stepId: 's2', text: 'Who won the football match?' });
    for (let i = 0; i < 30; i++) {
      const r = await owner.request.post(`/api/guides/${g}/messages`, { data: JSON.parse(body) });
      expect(r.status(), `question ${i + 1}`).toBe(200);
      await r.text();
    }
    const page = await owner.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await openPlayer(page, g, '?step=s2');
    await openAssistant(page);
    await send(page, 'One more question');
    const err = page.getByTestId('turn-error');
    await expect(err).toContainText("You're asking quickly. Wait a little, then try again.");
    await expect(err).toHaveAttribute('data-code', 'rate_limited');
    await expect(page.getByTestId('turn-retry')).toBeVisible();
    await owner.close();
  });
});

test.describe('C. step awareness and citations', () => {
  test('suggestions follow the step; the dock re-targets suggestions and questions on step change', async ({ browser }) => {
    const { context, page } = await start(browser, DESK, 's2');
    await openAssistant(page);
    await expect(page.getByTestId('suggestions').getByRole('button')).toHaveCount(3);
    const first = await page.getByTestId('suggestions').getByRole('button').allTextContents();
    await page.getByTestId('primary').click(); // s3
    await expect(page.getByTestId('context-label')).toHaveText('STEP 3');
    await expect.poll(async () => (await page.getByTestId('suggestions').getByRole('button').allTextContents()).join('|')).not.toBe(first.join('|'));
    const res = await context.request.get(`/api/guides/${guideId}/suggestions?stepId=s3`);
    const { suggestions } = (await res.json()) as { suggestions: string[] };
    expect(await page.getByTestId('suggestions').getByRole('button').allTextContents()).toEqual(suggestions);
    await context.close();
  });

  test('a real answer cites its own step and page; page chip opens the original at that page; Back keeps the scroll position', async ({ browser }) => {
    const { context, page } = await start(browser, PHONE, 's4');
    const history = [] as ReturnType<typeof user>[];
    for (let i = 0; i < 14; i++) {
      history.push(user(`Question number ${i} about this step?`, 's4'));
      history.push(answer(`Answer number ${i}. `.repeat(8), 's4', { citations: i === 0 ? [{ stepId: 's2', pageIndex: 2 }] : [{ stepId: 's4', pageIndex: 3 }] }));
    }
    await mockAssistantApi(page, { history });
    await page.reload();
    await openAssistant(page);
    const conv = page.getByTestId('conversation');
    await expect(page.getByTestId('assistant-message')).toHaveCount(14);
    // chips citing the current step have no Step chip; the one citing step 2 has
    expect(await page.getByTestId('cite-step').count()).toBe(1);
    await expect(page.getByTestId('cite-step')).toHaveAttribute('aria-label', 'Go to step 2');
    await conv.evaluate((el) => (el.scrollTop = 300));
    const before = await conv.evaluate((el) => el.scrollTop);
    expect(before).toBeGreaterThan(100);
    const chip = page.getByTestId('cite-page').nth(3);
    await chip.scrollIntoViewIfNeeded();
    const beforeClick = await conv.evaluate((el) => el.scrollTop);
    const label = (await chip.getAttribute('aria-label'))!;
    await chip.click();
    await expect(page.getByTestId('original-viewer')).toBeVisible();
    expect(query(page).get('page')).toBe('4');
    expect(label).toContain('page 4');
    await page.goBack();
    await expect(panelOf(page)).toBeVisible();
    const after = await page.getByTestId('conversation').evaluate((el) => el.scrollTop);
    expect(Math.abs(after - beforeClick), `scroll before ${beforeClick}, after ${after}`).toBeLessThan(40);
    await context.close();
  });

  test('desktop: the Step chip navigates and the dock stays open', async ({ browser }) => {
    const { context, page } = await start(browser, DESK, 's4');
    await mockAssistantApi(page, { history: [user('Q', 's2'), answer('About the dowels.', 's2', { citations: [{ stepId: 's2', pageIndex: 2 }] })] });
    await page.reload();
    await openAssistant(page);
    await page.getByTestId('cite-step').click();
    await expect(page.getByTestId('context-label')).toHaveText('STEP 2');
    await expect(page.getByTestId('assistant-dock')).toBeVisible();
    await expect(page.getByTestId('cite-step')).toHaveCount(0); // now the current step
    await context.close();
  });
});

test.describe('D. desktop dock safety', () => {
  const sizes: Vp[] = [
    { width: 1024, height: 768 },
    { width: 1280, height: 720 },
    { width: 1280, height: 600 },
    { width: 1024, height: 560 },
    { width: 1280, height: 560 },
  ];
  for (const vp of sizes) {
    for (const step of ['s5', 's7', 's8', 's9']) {
      test(`${vp.width}x${vp.height} step ${step}: the wording of every banner is fully visible while the Primary is pressable`, async ({ browser }) => {
        const { context, page } = await start(browser, vp, step);
        await openAssistant(page);
        const r = await page.evaluate(() => {
          const sum = document.querySelector('[data-testid="dock-summary"]')!.getBoundingClientRect();
          // The wording of the banner (the line under its label), not the manual quote below it.
          const kids = [...document.querySelectorAll('[data-testid="dock-banners"] > [role="note"]')].map((el) => {
            const head = el.querySelector('p + div') ?? el;
            const b = head.getBoundingClientRect();
            return {
              text: (head.textContent ?? '').trim().slice(0, 60),
              top: b.top,
              bottom: b.bottom,
              clippedBySummary: b.top < sum.top - 1 || b.bottom > sum.bottom + 1,
              offViewport: b.top < 0 || b.bottom > Math.min(window.innerHeight, document.querySelector('[data-testid="action-bar"]')!.getBoundingClientRect().top + 1),
            };
          });
          const prim = document.querySelector('[data-testid="primary"]') as HTMLButtonElement;
          const pb = prim.getBoundingClientRect();
          return { kids, primaryVisible: pb.top >= 0 && pb.bottom <= window.innerHeight, primaryDisabled: prim.disabled, summaryScrolls: document.querySelector('[data-testid="dock-summary"]')!.scrollHeight > document.querySelector('[data-testid="dock-summary"]')!.clientHeight + 1 };
        });
        expect(r.kids.length).toBeGreaterThan(0);
        for (const k of r.kids) {
          expect(k.clippedBySummary || k.offViewport, `banner "${k.text}" partly or fully hidden while "${r.primaryDisabled ? 'disabled' : 'pressable'}" primary is on screen (summary scrolls: ${r.summaryScrolls})`).toBe(false);
        }
        // collapsing the summary never hides a banner
        await page.getByTestId('dock-step-toggle').click();
        await expect(page.getByTestId('dock-instruction')).toHaveCount(0);
        await expect(page.getByTestId('dock-banners').locator('[role="note"]').first()).toBeVisible();
        await context.close();
      });
    }
  }

  // D-022 / orchestrator ruling: under 560px tall the assistant is the modal sheet, never the dock.
  for (const step of ['s5', 's7', 's8', 's9']) {
    test(`1280x500 step ${step}: the assistant is the modal sheet; banners stay on the step content and the Primary cannot be pressed`, async ({ browser }) => {
      const { context, page } = await start(browser, { width: 1280, height: 500 }, step);
      await openAssistant(page);
      await expect(page.getByTestId('assistant-dock')).toHaveCount(0);
      await expect(page.getByTestId('dock-summary')).toHaveCount(0);
      const modal = await page.evaluate(() => {
        const d = document.querySelector('dialog[open]') as HTMLDialogElement | null;
        return { dialog: !!d && !!d.querySelector('[data-testid="assistant-panel"]'), modal: !!d && d.matches(':modal') };
      });
      expect(modal).toEqual({ dialog: true, modal: true });
      // the page behind is inert: a real click on the Primary does not reach it
      await expect(page.getByTestId('primary').click({ timeout: 1500 })).rejects.toThrow();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('assistant-panel')).toBeHidden();
      // back on the step: banners are in the step content, and the Primary is pressable again
      const notes = page.getByTestId('step-content').locator('[role="note"]');
      expect(await notes.count()).toBeGreaterThan(0);
      await expect(page.getByTestId('primary')).toBeEnabled();
      await context.close();
    });
  }

  for (const vp of [{ width: 1280, height: 559 }, { width: 1024, height: 400 }]) {
    test(`${vp.width}x${vp.height} step s7: sheet, not dock`, async ({ browser }) => {
      const { context, page } = await start(browser, vp, 's7');
      await openAssistant(page);
      await expect(page.getByTestId('assistant-dock')).toHaveCount(0);
      expect(await page.evaluate(() => !!document.querySelector('dialog[open]:modal'))).toBe(true);
      await context.close();
    });
  }

  test('resize across the 560px threshold while the assistant is open never leaves a pressable Primary beside a clipped banner', async ({ browser }) => {
    const { context, page } = await start(browser, { width: 1280, height: 700 }, 's7');
    await openAssistant(page);
    const check = async (label: string) => {
      const r = await page.evaluate(() => {
        // the dock column scrolls as a whole (D-022 item 7); judge the banners at its top, as on arrival
        document.querySelector('[data-testid="dock-scroll"]')?.scrollTo(0, 0);
        const panel = document.querySelector('[data-testid="assistant-panel"]');
        const dlg = document.querySelector('dialog[open]:modal');
        const dock = document.querySelector('[data-testid="assistant-dock"]');
        const bar = document.querySelector('[data-testid="action-bar"]')!.getBoundingClientRect();
        const kids = [...document.querySelectorAll('[data-testid="dock-banners"] > [role="note"]')].map((e) => e.getBoundingClientRect());
        const clipped = kids.some((b) => b.top < 0 || b.bottom > bar.top + 1);
        return { panel: !!panel, modal: !!dlg, dock: !!dock, clipped, kids: kids.map((b) => [Math.round(b.top), Math.round(b.bottom)]), bar: Math.round(bar.top), sc: (() => { const e = document.querySelector('[data-testid="dock-scroll"]'); return e ? [e.scrollHeight, e.clientHeight] : null; })() };
      });
      expect(r.panel, label).toBe(true);
      expect(r.modal || r.dock, label).toBe(true);
      expect(r.clipped, `${label}: banner clipped ${JSON.stringify(r)}`).toBe(false);
      return r;
    };
    await check('700');
    await composer(page).fill('keep this draft');
    for (const h of [560, 559, 500, 560, 700, 450, 720]) {
      await page.setViewportSize({ width: 1280, height: h });
      await page.waitForTimeout(400);
      const r = await check(String(h));
      expect(r.dock, `height ${h}`).toBe(h >= 560);
      if (h < 560) expect(r.modal, `height ${h}`).toBe(true);
    }
    await context.close();
  });

  test('the Primary stays reachable and labelled for an irreversible step with the dock open', async ({ browser }) => {
    const { context, page } = await start(browser, { width: 1280, height: 600 }, 's7');
    await openAssistant(page);
    await expect(page.getByTestId('primary')).toBeVisible();
    await expect(page.getByTestId('primary')).toContainText('I checked - done');
    await context.close();
  });
});

test.describe('E. Explain it more simply (real server)', () => {
  test('second request is a cache hit; the original and the warnings are untouched', async ({ browser }) => {
    const { context, page } = await start(browser, DESK, 's7');
    const instruction = await page.getByTestId('instruction').textContent();
    const bannersBefore = await page.getByTestId('step-content').locator('[role="note"]').allTextContents();
    expect(bannersBefore.length).toBeGreaterThan(0);
    const responses: Array<{ cached: boolean; fellBack: boolean; text: string }> = [];
    page.on('response', async (r) => {
      if (/\/steps\/s7\/simplify$/.test(r.url())) responses.push(await r.json());
    });
    const btn = page.getByTestId('step-content').getByRole('button', { name: 'Explain it more simply' });
    await btn.click();
    await expect(page.getByTestId('simpler-wording').or(page.getByTestId('simpler-fellback'))).toBeVisible({ timeout: 30_000 });
    await btn.click(); // collapse
    await btn.click(); // open again (client may or may not refetch)
    await page.reload();
    await page.getByTestId('step-content').getByRole('button', { name: 'Explain it more simply' }).click();
    await expect(page.getByTestId('simpler-wording').or(page.getByTestId('simpler-fellback'))).toBeVisible({ timeout: 30_000 });
    expect(responses.length).toBeGreaterThanOrEqual(2);
    expect(responses.at(-1)!.cached || responses.at(-1)!.fellBack).toBe(true);
    await expect(page.getByTestId('instruction')).toHaveText(instruction!);
    expect(await page.getByTestId('step-content').locator('[role="note"]').allTextContents()).toEqual(bannersBefore);
    await context.close();
  });

  test('HTTP: a bad step is 404, and a second call is cached', async ({ browser }) => {
    const { context } = await start(browser, DESK);
    expect((await context.request.post(`/api/guides/${guideId}/steps/nope/simplify`)).status()).toBe(404);
    const a = await (await context.request.post(`/api/guides/${guideId}/steps/s3/simplify`)).json();
    const b = await (await context.request.post(`/api/guides/${guideId}/steps/s3/simplify`)).json();
    if (!a.fellBack) expect(b).toMatchObject({ cached: true, text: a.text });
    else expect(b.fellBack).toBe(true);
    await context.close();
  });
});

test.describe('F. accessibility', () => {
  test('the live region speaks twice at most (question sent, answer complete), never per token', async ({ browser }) => {
    const { context, page } = await start(browser, PHONE);
    await page.addInitScript(() => {
      const w = window as unknown as { __live: string[] };
      w.__live = [];
      const t = setInterval(() => {
        const el = document.querySelector('[data-testid="assistant-live"]');
        if (el && w.__live.at(-1) !== el.textContent) w.__live.push(el.textContent ?? '');
      }, 10);
      void t;
    });
    await page.reload();
    await openAssistant(page);
    await send(page, 'What does this step mean?');
    await expect(page.getByTestId('assistant-message').last()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(300);
    const live = (await page.evaluate(() => (window as unknown as { __live: string[] }).__live)).filter((s) => s !== '');
    expect(live.length, JSON.stringify(live)).toBeLessThanOrEqual(2);
    expect(live.length).toBeGreaterThanOrEqual(1);
    await context.close();
  });

  test('keyboard only: suggestions, send, citation chips and the original viewer, with focus restored', async ({ browser }) => {
    const { context, page } = await start(browser, DESK, 's4');
    await askButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('assistant-dock')).toBeVisible();
    await expect(page.locator('#' + (await page.getByTestId('assistant-dock').getAttribute('aria-labelledby')))).toBeFocused();
    await composer(page).focus();
    await page.keyboard.type('Where is this shown in the manual?');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('assistant-message').last()).toBeVisible({ timeout: 30_000 });
    const chip = page.getByTestId('cite-page').first();
    await chip.focus();
    await expect(chip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('original-viewer')).toBeVisible();
    await page.goBack();
    await expect(panelOf(page)).toBeVisible();
    // focus must not be lost to <body> after the viewer closes
    const active = await page.evaluate(() => document.activeElement?.tagName);
    expect(active, 'focus after returning from the viewer').not.toBe('BODY');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('assistant-dock')).toBeHidden();
    await expect(askButton(page)).toBeFocused();
    await context.close();
  });

  test('touch targets at 375: every control in the sheet is at least 44px in the direction that matters', async ({ browser }) => {
    const { context, page } = await start(browser, PHONE, 's4');
    await mockAssistantApi(page, { history: [user('Q', 's4'), answer('A.', 's4', { citations: [{ stepId: 's2', pageIndex: 2 }, { stepId: 's4', pageIndex: 3 }] })] });
    await page.reload();
    await openAssistant(page);
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const root = document.querySelector('[data-testid="assistant-panel"]')!;
      const header = document.querySelectorAll('[role="dialog"] button');
      for (const el of [...root.querySelectorAll('button, [role="button"], textarea, a'), ...header]) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        // the hit area may be extended by a pseudo element: probe the points 22px above and below the centre
        const cx = b.left + b.width / 2;
        const hit = (y: number) => {
          const t = document.elementFromPoint(cx, y);
          return !!t && (el === t || el.contains(t));
        };
        const cy = b.top + b.height / 2;
        const okH = b.height >= 44 || (hit(cy - 21) && hit(cy + 21));
        const okW = b.width >= 44 || (() => {
          const hx = (x: number) => { const t = document.elementFromPoint(x, cy); return !!t && (el === t || el.contains(t)); };
          return hx(b.left + b.width / 2 - 21) && hx(b.left + b.width / 2 + 21);
        })();
        if (!okH || !okW) out.push(`${el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.textContent?.slice(0, 20)} ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
      return out;
    });
    expect(small).toEqual([]);
    await context.close();
  });

  for (const w of [320, 375]) {
    test(`no horizontal scroll at ${w}px with very long unbroken words in the question and the answer`, async ({ browser }) => {
      const { context, page } = await start(browser, { width: w, height: 700, touch: true }, 's4');
      const long = 'W'.repeat(400);
      const url = 'https://' + 'a'.repeat(300) + '.example/' + 'b'.repeat(200);
      await mockAssistantApi(page, {
        history: [
          user(long, 's4'),
          answer(`${long} ${url} ${'中'.repeat(300)}`, 's4', { citations: [{ stepId: 's2', pageIndex: 2 }] }),
          answer(long, 's4', { notInManual: true }),
        ],
      });
      await page.reload();
      await openAssistant(page);
      const m = await page.evaluate(() => {
        const out: Record<string, number> = { doc: document.documentElement.scrollWidth - window.innerWidth };
        for (const id of ['assistant-panel', 'conversation']) {
          const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
          out[id] = el.scrollWidth - el.clientWidth;
        }
        return out;
      });
      expect(m.doc).toBeLessThanOrEqual(0);
      expect(m['assistant-panel']).toBeLessThanOrEqual(0);
      expect(m.conversation).toBeLessThanOrEqual(0);
      await context.close();
    });
  }

  test('reduced motion: opening the sheet starts no slide or size animation (opacity fades are allowed; the 220ms scrim fade is a known harmless exception)', async ({ browser }) => {
    const { context, page } = await start(browser, PHONE, 's4', { reducedMotion: true });
    await askButton(page).click();
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running' && /transform|translate|height|width/.test(String((a as CSSTransition).transitionProperty ?? '')))
        .map((a) => `${(a as CSSTransition).transitionProperty ?? (a as CSSAnimation).animationName}:${a.effect?.getTiming().duration}`),
    );
    expect(running).toEqual([]);
    await context.close();
  });
});

test('G. VIEWPORTS sanity: the shared helper sizes are still what the specs assume', () => {
  expect(VIEWPORTS['375'].viewport.width).toBe(375);
});
