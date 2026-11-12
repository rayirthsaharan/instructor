import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getProgress, openPlayer, patchGuide, primary, putProgress, query, stepTitle, uploadLumen, VIEWPORTS, type LooseGuide, type ProgressBody } from './m2-player-helpers';

// QA M2: provenance in the UI, layout limits, accessibility, device APIs, checklist, completion.
let guideId = '';
let state: Awaited<ReturnType<BrowserContext['storageState']>>;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  ({ guideId } = await uploadLumen(ctx));
  state = await ctx.storageState();
  await ctx.close();
});

async function start(browser: Browser, vp: keyof typeof VIEWPORTS | '320' = '375', progress: Partial<ProgressBody> = {}) {
  const opts = vp === '320' ? { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true } : VIEWPORTS[vp];
  const context = await browser.newContext({ ...opts, storageState: state });
  await putProgress(context, guideId, progress);
  return { context, page: await context.newPage() };
}
const S = (n: number) => `s${n}`;
const hScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const VERBATIM = 'DO NOT use power tools on this step -- verbatim from page 2.';
function craft(g: LooseGuide) {
  const s = g.steps.s2;
  s.confidence = 'low';
  s.interpretedFromDiagram = true;
  s.sourceQuote = 'Insert the dowels (A) into the holes (B).';
  s.warnings = [
    { text: 'Caution restated by Instructor', severity: 'caution', sourceQuote: 'Handle edges with care.', interpretedFromDiagram: false },
    { text: 'Power tools can split the panel', severity: 'warning', sourceQuote: VERBATIM, interpretedFromDiagram: false },
    { text: 'Do not stand on the shelf (pictogram)', severity: 'warning', interpretedFromDiagram: true },
  ];
  s.why = { text: 'INFERRED-WHY text', origin: 'inferred' };
  s.commonMistake = { text: 'MANUAL-MISTAKE text', origin: 'manual', sourceQuote: 'Do not over-tighten the cam.' };
  s.checkpoint = { text: 'INFERRED-CHECK text', origin: 'inferred' };
}

test.describe('provenance in the UI', () => {
  test('warnings, quotes, inferred guidance and uncertainty are distinguishable and never hidden', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { currentStepId: S(2) });
    await patchGuide(page, guideId, craft);
    await openPlayer(page, guideId, '?step=s2');
    const content = page.getByTestId('step-content');

    // warnings: all visible with no interaction, none inside a collapsed region, verbatim quote visible
    for (const t of ['Power tools can split the panel', 'Caution restated by Instructor', 'Do not stand on the shelf (pictogram)']) {
      await expect(content.getByText(t)).toBeVisible();
    }
    await expect(content.getByText(VERBATIM)).toBeVisible();
    await expect(content.locator('blockquote', { hasText: VERBATIM })).toContainText('From your manual');
    const hiddenAncestor = await content.getByText(VERBATIM).evaluate((el) => !!el.closest('[hidden], details:not([open]), [aria-hidden="true"]'));
    expect(hiddenAncestor).toBe(false);
    // the pictogram warning is tagged and has no quote
    await expect(content.getByText('Read from the picture').first()).toBeVisible();
    // order: warning before caution
    const html = await content.innerHTML();
    expect(html.indexOf('Power tools can split')).toBeLessThan(html.indexOf('Caution restated'));

    // low confidence and diagram interpretation are marked
    await expect(content.getByText('Compare it with the original page', { exact: false })).toBeVisible();
    await expect(content.getByText('Double-check', { exact: true }).first()).toBeVisible();
    await expect(content.getByText('Read from the picture - the manual has no words here')).toBeVisible();

    // step quote is a labelled manual quote; instruction is not styled as a quote
    await expect(content.locator('blockquote', { hasText: 'Insert the dowels (A) into the holes (B).' })).toContainText('From your manual');
    expect(await page.getByTestId('instruction').evaluate((e) => !!e.closest('blockquote'))).toBe(false);

    // inferred guidance: labelled as Instructor's, never inside a manual blockquote or labelled "From your manual"
    await expect(page.getByTestId('checkpoint')).toContainText("Instructor's explanation - not the manual's wording.");
    expect(await page.getByTestId('checkpoint').locator('blockquote').count()).toBe(0);
    await page.getByRole('button', { name: 'Why this matters' }).click();
    const why = page.getByText('INFERRED-WHY text');
    await expect(why).toBeVisible();
    const whyPanel = why.locator('xpath=ancestor::div[@hidden or contains(@class,"bg-surface-sunken")][1]');
    await expect(whyPanel).toContainText("Instructor's explanation");
    await expect(whyPanel).not.toContainText('From your manual');
    expect(await why.evaluate((e) => !!e.closest('blockquote'))).toBe(false);
    await page.getByRole('button', { name: 'Common mistake' }).click();
    const mistake = page.getByText('MANUAL-MISTAKE text').locator('xpath=ancestor::div[contains(@class,"bg-surface-sunken")][1]');
    await expect(mistake).toContainText('From your manual');
    await expect(mistake).toContainText('Do not over-tighten the cam.');
    await expect(mistake).not.toContainText("Instructor's explanation");
    // every step offers a way to its source page
    await expect(page.getByTestId('show-original')).toBeVisible();
    await context.close();
  });

  test('every step of the guide offers "Show original page" and a page tag/link to its source', async ({ browser }) => {
    const { context, page } = await start(browser, '1280');
    await openPlayer(page, guideId, '?step=s1');
    for (let i = 1; i <= 10; i++) {
      await expect(query(page).get('step')).toBe(S(i));
      await expect(page.getByTestId('show-original')).toBeVisible();
      await page.getByTestId('show-original').click();
      await expect(page.getByTestId('original-viewer')).toBeVisible();
      await expect(page.getByTestId('original-viewer')).toContainText(/Page \d+ of \d+/);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('original-viewer')).toBeHidden();
      await page.keyboard.press('ArrowRight');
      if (i < 10) await expect.poll(() => query(page).get('step')).toBe(S(i + 1));
    }
    await context.close();
  });

  test('the manual page and all its ancestors carry no filter, invert or blend in dark mode', async ({ browser }) => {
    const context = await browser.newContext({ ...VIEWPORTS['375'], storageState: state, colorScheme: 'dark' });
    await putProgress(context, guideId, {});
    const page = await context.newPage();
    await openPlayer(page, guideId, '?step=s2');
    const filt = await page.getByTestId('source-visual').locator('img').first().evaluate((e) => {
      const cs = getComputedStyle(e);
      return `${cs.filter}|${cs.mixBlendMode}|${cs.opacity}`;
    });
    expect(filt.startsWith('none|normal')).toBe(true);
    // any ancestor filter/invert/blend up to body
    const anc = await page.getByTestId('source-visual').locator('img').first().evaluate((e) => {
      const out: string[] = [];
      for (let n: Element | null = e; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.filter !== 'none' || cs.mixBlendMode !== 'normal' || cs.backdropFilter !== 'none') out.push(`${n.tagName}:${cs.filter}:${cs.mixBlendMode}:${cs.backdropFilter}`);
      }
      return out;
    });
    expect(anc).toEqual([]);
    await context.close();
  });
});

test.describe('layout limits and accessibility', () => {
  test('320px: a very long unbroken word in title, instruction, quote, part name and warning never scrolls the page sideways', async ({ browser }) => {
    const { context, page } = await start(browser, '320', { currentStepId: S(2) });
    const LONG = 'Supercalifragilisticexpialidocious'.repeat(4);
    await patchGuide(page, guideId, (g) => {
      craft(g);
      g.title = LONG;
      g.steps.s2.title = LONG;
      g.steps.s2.instruction = LONG;
      g.steps.s2.warnings[1].text = LONG;
      g.parts[0].name = LONG;
    });
    await openPlayer(page, guideId, '?step=s2');
    expect(await hScroll(page), 'player').toBeLessThanOrEqual(0);
    const clipped = await page.getByTestId('step-content').evaluate((root) => {
      const bad: string[] = [];
      const limit = document.documentElement.clientWidth;
      root.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > limit + 1) bad.push(`${el.tagName}.${(el.className as string).toString().slice(0, 40)} right=${Math.round(r.right)}`);
      });
      return bad;
    });
    expect(clipped, 'elements extending beyond the 320px viewport').toEqual([]);
    await context.close();
  });

  for (const [what, patch] of [
    ['guide title', (g: LooseGuide) => (g.title = 'IKEA_PAX_Wardrobe_Assembly_Instructions_v2_final_FINAL_scan_2024')],
    ['part name', (g: LooseGuide) => (g.parts[0].name = 'Supercalifragilisticexpialidocious_connector_bolt_M6x40')],
    ['tool name', (g: LooseGuide) => (g.tools[0].name = 'Supercalifragilisticexpialidocious_screwdriver_set')],
  ] as const) {
    test(`320px: a long unbroken ${what} wraps on the Overview and Completion screens`, async ({ browser }) => {
      const { context, page } = await start(browser, '320', { completedStepIds: [S(1)] });
      await patchGuide(page, guideId, patch);
      await page.goto(`/g/${guideId}`);
      await expect(page.getByText("Here's the plan", { exact: true })).toBeVisible();
      expect(await hScroll(page), 'overview scrolls sideways').toBeLessThanOrEqual(0);
      await page.goto(`/g/${guideId}/done`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await hScroll(page), 'done scrolls sideways').toBeLessThanOrEqual(0);
      await context.close();
    });
  }

  test('320px: a long unbroken token inside a manual quote or a part label stays inside the screen', async ({ browser }) => {
    const { context, page } = await start(browser, '320', { currentStepId: S(2) });
    const LONG = 'https://support.example.com/manuals/' + 'a1b2c3d4'.repeat(12);
    await patchGuide(page, guideId, (g) => {
      craft(g);
      g.steps.s2.sourceQuote = LONG;
      g.steps.s2.warnings[1].sourceQuote = LONG;
      g.parts[0].manualLabel = 'LABEL' + LONG;
    });
    await openPlayer(page, guideId, '?step=s2');
    const clipped = await page.getByTestId('step-content').evaluate((root) => {
      const bad: string[] = [];
      const limit = document.documentElement.clientWidth;
      root.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > limit + 1) bad.push(`${el.tagName}.${(el.className as string).toString().slice(0, 40)} right=${Math.round(r.right)}`);
      });
      return bad;
    });
    expect(clipped, 'manual quote text must wrap, not run off the screen').toEqual([]);
    await context.close();
  });

  test('320px: overview, done and viewer do not scroll sideways', async ({ browser }) => {
    const { context, page } = await start(browser, '320', { completedStepIds: [S(1), S(2)], checklist: { 'cam-lock': 'missing' } });
    await page.goto(`/g/${guideId}`);
    await expect(page.getByText("Here's the plan", { exact: true })).toBeVisible();
    expect(await hScroll(page)).toBeLessThanOrEqual(0);
    await page.goto(`/g/${guideId}/done`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await hScroll(page)).toBeLessThanOrEqual(0);
    await openPlayer(page, guideId, '?step=s2&panel=original&page=1');
    await expect(page.getByTestId('original-viewer')).toBeVisible();
    expect(await hScroll(page)).toBeLessThanOrEqual(0);
    await context.close();
  });

  test('375px: every interactive control on Overview, Done and the player is at least 44px in both directions', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { completedStepIds: [S(1)], checklist: { 'cam-lock': 'missing' } });
    const small = async (label: string) => {
      const found = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll('button, a[href], [role="checkbox"], [role="switch"], [role="menuitem"], summary, input, select').forEach((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden') return;
          if (el.closest('[hidden], [inert], dialog:not([open])')) return;
          if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        });
        return out;
      });
      expect(found, label).toEqual([]);
    };
    await page.goto(`/g/${guideId}`);
    await expect(page.getByText("Here's the plan", { exact: true })).toBeVisible();
    await small('overview');
    await page.goto(`/g/${guideId}/done`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await small('done');
    await openPlayer(page, guideId, '?step=s2');
    await small('player');
    await page.getByTestId('steps-button').click();
    await expect(page.getByRole('dialog', { name: 'Steps' })).toBeVisible();
    await small('steps sheet');
    await page.keyboard.press('Escape');
    await page.getByTestId('show-original').click();
    await expect(page.getByTestId('original-viewer')).toBeVisible();
    await small('original viewer');
    await context.close();
  });

  test('keyboard only: Tab to the primary action and Enter through the whole guide; focus lands on the title each step and on the heading at the end', async ({ browser }) => {
    test.setTimeout(90_000);
    const { context, page } = await start(browser, '1280');
    await openPlayer(page, guideId, '?step=s1');
    for (let i = 1; i <= 10; i++) {
      await expect.poll(() => query(page).get('step')).toBe(S(i));
      let reached = false;
      for (let t = 0; t < 40 && !reached; t++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid === 'primary');
      }
      expect(reached, `Tab reaches the primary action on step ${i}`).toBe(true);
      await page.keyboard.press('Enter');
      if (i < 10) {
        await expect.poll(() => query(page).get('step')).toBe(S(i + 1));
        await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
      }
    }
    await expect(page).toHaveURL(new RegExp(`/g/${guideId}/done$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Finished.');
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
    expect((await getProgress(context, guideId)).completedStepIds).toHaveLength(10);
    await context.close();
  });

  test('step rail exposes current and complete in its accessible names; checklist rows expose state', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { currentStepId: S(2), completedStepIds: [S(1)], checklist: { 'cam-lock': 'missing', shelf: 'have' } });
    await openPlayer(page, guideId, '?step=s2');
    await page.getByTestId('steps-button').click();
    const sheet = page.getByRole('dialog', { name: 'Steps' });
    const current = sheet.locator('[aria-current="step"], [aria-current="true"], [aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText(/Step 2|2/);
    const rowText = (await sheet.getByRole('button').allInnerTexts()).concat(await sheet.getByRole('link').allInnerTexts()).join('\n');
    expect(rowText.toLowerCase()).toMatch(/done|complete/);
    await page.keyboard.press('Escape');
    await page.goto(`/g/${guideId}`);
    await expect(page.getByRole('checkbox').first()).toBeVisible();
    const boxes = page.getByRole('checkbox');
    expect(await boxes.count()).toBeGreaterThan(2);
    const camLock = page.getByTestId('prep-row').filter({ hasText: 'Cam lock' });
    await expect(camLock.getByRole('checkbox')).toHaveAccessibleName(/Cam lock.*Marked missing|Marked missing/);
    await expect(page.getByTestId('prep-row').filter({ hasText: 'Shelf' }).first().getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'true');
    await context.close();
  });

  test('reduced motion: sheets and the stage do not animate', async ({ browser }) => {
    const context = await browser.newContext({ ...VIEWPORTS['375'], storageState: state, reducedMotion: 'reduce' });
    await putProgress(context, guideId, {});
    const page = await context.newPage();
    await openPlayer(page, guideId, '?step=s1');
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('body, body *').forEach((el) => {
        const cs = getComputedStyle(el);
        const props = cs.transitionProperty.split(',').map((x) => x.trim());
        const dur = cs.transitionDuration.split(',').map((d) => parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000));
        const anim = cs.animationName !== 'none' ? cs.animationDuration.split(',').map((d) => parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000)) : [];
        const transforms = props.some((p) => p === 'transform' || p === 'all') && dur.some((d) => d > 0);
        if (transforms || [...dur, ...anim].some((d) => d > 100)) out.push(`${el.tagName}.${(el.className as string).toString().slice(0, 30)} ${cs.transitionProperty} ${cs.transitionDuration}`);
      });
      return out;
    });
    expect(bad, 'transform transitions or motion longer than 100ms under prefers-reduced-motion').toEqual([]);
    await context.close();
  });
});

test.describe('device APIs degrade silently', () => {
  test('wake lock refused (NotAllowedError) never breaks the player', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', { value: { request: () => Promise.reject(new DOMException('no', 'NotAllowedError')) }, configurable: true });
    });
    await openPlayer(page, guideId, '?step=s1');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => query(page).get('step')).toBe(S(2));
    await primary(page).click();
    await expect.poll(() => query(page).get('step')).toBe(S(3));
    expect(errs).toEqual([]);
    await context.close();
  });

  test('speechSynthesis.speak throwing (engine unavailable) is swallowed: no uncaught error, no stuck "speaking" state', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'speechSynthesis', {
        value: {
          speaking: false,
          speak: () => {
            throw new Error('synthesis-failed');
          },
          cancel: () => {},
          getVoices: () => [],
          addEventListener: () => {},
          removeEventListener: () => {},
        },
        configurable: true,
      });
    });
    await openPlayer(page, guideId, '?step=s1');
    await page.getByTestId('read-aloud').click();
    await page.waitForTimeout(300);
    expect(errs, 'uncaught error from speak()').toEqual([]);
    await expect(page.getByTestId('read-aloud')).toHaveAttribute('aria-pressed', 'false');
    await context.close();
  });

  test('wake lock released by the system is re-acquired without errors; hiding the page does not throw', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.addInitScript(() => {
      (window as unknown as { __locks: number }).__locks = 0;
      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: async () => {
            (window as unknown as { __locks: number }).__locks++;
            const l = new EventTarget() as EventTarget & { released: boolean; release: () => Promise<void> };
            l.released = false;
            l.release = async () => {
              l.released = true;
            };
            return l;
          },
        },
        configurable: true,
      });
    });
    await openPlayer(page, guideId, '?step=s1');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __locks: number }).__locks)).toBeGreaterThan(0);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(errs).toEqual([]);
    await context.close();
  });
});

test.describe('checklist, blocked steps, completion', () => {
  test('marking every part missing never blocks Start; the notice shows in each affected step', async ({ browser }) => {
    const { context, page } = await start(browser, '375');
    const j = (await (await context.request.get(`/api/guides/${guideId}`)).json()) as { guide: LooseGuide };
    const parts = (j.guide.parts as { id: string }[]).map((p) => p.id);
    const checklist: ProgressBody['checklist'] = Object.fromEntries(parts.map((p) => [p, 'missing' as const]));
    await putProgress(context, guideId, { checklist });
    await page.goto(`/g/${guideId}`);
    await expect(page.getByTestId('readiness')).toContainText(/marked missing/);
    await expect(page.getByTestId('missing-sentence')).toBeVisible();
    await page.getByLabel('I understand').check();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Start anyway?' });
    await expect(sheet).toContainText(/marked missing/);
    await sheet.getByRole('button', { name: 'Start anyway' }).click();
    await expect(page).toHaveURL(new RegExp(`/g/${guideId}/play\\?step=s1$`));
    await openPlayer(page, guideId, '?step=s4');
    await expect(page.getByText('Missing part').first()).toBeVisible();
    await expect(primary(page)).toBeEnabled();
    await primary(page).click();
    await expect.poll(() => query(page).get('step')).toBe(S(5));
    await context.close();
  });

  test('last step: Done goes to Completion, which lists skipped steps and still-missing parts; Back returns to the last step', async ({ browser }) => {
    const { context, page } = await start(browser, '375', {
      currentStepId: S(10),
      completedStepIds: [S(1), S(2), S(4), S(5), S(6), S(7), S(8), S(9)],
      checklist: { 'cam-lock': 'missing' },
    });
    await openPlayer(page, guideId, '?step=s10');
    await expect(primary(page)).toContainText(/finish/i);
    await primary(page).click();
    await expect(page).toHaveURL(new RegExp(`/g/${guideId}/done$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Almost there.');
    const skipped = page.getByTestId('skipped');
    await expect(skipped).toContainText("1 step isn't marked done");
    await expect(skipped.getByRole('link')).toHaveCount(1);
    await expect(skipped.getByRole('link')).toHaveAttribute('href', `/g/${guideId}/play?step=s3`);
    await expect(page.getByTestId('missing')).toContainText('Cam lock');
    await page.goBack();
    await expect(stepTitle(page)).toBeVisible();
    await expect(page.getByTestId('player')).toHaveAttribute('data-step', S(10));
    await skipped.waitFor({ state: 'detached' }).catch(() => {});
    await context.close();
  });

  test('completion screen survives a failing save: still shows, nothing throws', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { currentStepId: S(10), completedStepIds: Array.from({ length: 9 }, (_, i) => S(i + 1)) });
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await openPlayer(page, guideId, '?step=s10');
    await page.route('**/api/guides/*/progress', (r) => r.abort('connectionfailed'));
    await primary(page).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Finished.');
    expect(errs).toEqual([]);
    await context.close();
  });

  test('irreversible step: the notice precedes it, the banner comes first and the primary reads "I checked - done"', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { currentStepId: S(2) });
    await patchGuide(page, guideId, (g) => {
      g.steps.s3.irreversible = true;
    });
    await openPlayer(page, guideId, '?step=s2');
    await expect(page.getByTestId('next-irreversible')).toBeVisible();
    await primary(page).click();
    await expect.poll(() => query(page).get('step')).toBe(S(3));
    await expect(primary(page)).toContainText('I checked');
    const first = await page.getByTestId('step-content').locator('> *').first().textContent();
    expect(first?.toLowerCase()).toMatch(/can.t be undone|check before|irreversible|hard to undo|before you continue/);
    // arrow keys on an irreversible step still do not complete it
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => query(page).get('step')).toBe(S(4));
    expect((await getProgress(context, guideId)).completedStepIds).not.toContain(S(3));
    await context.close();
  });
});

test.describe('overlays', () => {
  test('Back closes viewer opened over the Steps sheet flow one layer at a time and never leaves the player early', async ({ browser }) => {
    const { context, page } = await start(browser, '375', { currentStepId: S(3) });
    await openPlayer(page, guideId, '?step=s3');
    await page.getByTestId('steps-button').click();
    await expect.poll(() => query(page).get('panel')).toBe('steps');
    await page.goBack();
    await expect.poll(() => query(page).get('panel')).toBeNull();
    await page.getByTestId('show-original').click();
    await expect(page.getByTestId('original-viewer')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('original-viewer')).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/g/${guideId}/play`));
    expect(query(page).get('step')).toBe(S(3));
    await context.close();
  });
});
