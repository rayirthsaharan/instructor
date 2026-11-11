import { test, expect, type Page } from '@playwright/test';

async function open(page: Page, w = 375, h = 800, url = '/dev/ui') {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'UI gallery' })).toBeVisible();
}

for (const w of [320, 375]) {
  test(`no horizontal scroll at ${w}`, async ({ page }) => {
    await open(page, w);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(o).toBeLessThanOrEqual(0);
  });
}

test('touch targets >= 44px at 375 (enabled buttons, checkboxes, links)', async ({ page }) => {
  await open(page);
  const small = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>('button:not([disabled]), [role=checkbox], a[href], [role=button]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return out;
  });
  expect(small).toEqual([]);
});

test('every interactive control has an accessible name', async ({ page }) => {
  await open(page);
  const bad = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [role=checkbox]'))
      .filter((el) => !(el.getAttribute('aria-label') || el.textContent?.trim()))
      .map((el) => el.outerHTML.slice(0, 80)),
  );
  expect(bad).toEqual([]);
});

test('keyboard focus is visible on every tabbable control', async ({ page }) => {
  await open(page, 1280, 900);
  const bad: string[] = [];
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none';
      return { visible, n: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30) };
    });
    if (r && !r.visible) bad.push(r.n);
  }
  expect(bad).toEqual([]);
});

test('checklist row: Space toggles, aria-checked reflects, missing is announced', async ({ page }) => {
  await open(page);
  const cb = page.getByRole('checkbox', { name: /Cam lock/ });
  await expect(cb).toHaveAttribute('aria-checked', 'false');
  await cb.focus();
  await page.keyboard.press('Space');
  await expect(cb).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Enter');
  await expect(cb).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('checkbox', { name: /Side panel.*Marked missing/ })).toBeVisible();
});

test('bottom sheet: aria, scroll lock, background inert, close button returns focus', async ({ page }) => {
  await open(page, 375, 500);
  const opener = page.getByRole('button', { name: 'Open bottom sheet' });
  await opener.scrollIntoViewIfNeeded();
  await opener.click();
  const d = page.getByRole('dialog', { name: 'Cam lock' });
  await expect(d).toHaveAttribute('aria-modal', 'true');
  // Page behind must not scroll while the sheet is open.
  const y0 = await page.evaluate(() => window.scrollY);
  await page.mouse.move(187, 20);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  const y1 = await page.evaluate(() => window.scrollY);
  expect(y1, 'background scrolled under open sheet').toBe(y0);
  // Background is inert to Tab: shift+Tab from title wraps inside.
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(d).toBeHidden();
  await expect(opener).toBeFocused();
  // reopen works (state in sync)
  await opener.click();
  await expect(d).toBeVisible();
});

test('dialog: Escape cancels and returns focus; aria-describedby set', async ({ page }) => {
  await open(page);
  const opener = page.getByRole('button', { name: 'Open dialog' });
  await opener.click();
  const d = page.getByRole('dialog', { name: 'Start again?' });
  await expect(d).toHaveAccessibleDescription(/progress/);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await expect(opener).toBeFocused();
});

test('toast: persistent polite live region, message announced inside it, auto-dismiss', async ({ page }) => {
  await open(page);
  const regions = page.locator('[role=status][aria-live=polite]');
  expect(await regions.count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Show toast', exact: true }).click();
  const live = page.locator('[aria-live=polite]:has(> .toast-enter)');
  await expect(live).toContainText('Marked as missing.');
  // no nested duplicate live region (would double-announce)
  expect(await live.locator('[aria-live],[role=status]').count()).toBe(0);
  await expect(live).toBeEmpty({ timeout: 6000 });
});

test('toast with action: keyboard reachable and Undo dismisses', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Show toast with Undo' }).click();
  const undo = page.getByRole('button', { name: 'Undo' }).last();
  await undo.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Part removed.').last()).toBeHidden();
});

test('banners: roles, labels carry meaning without colour, error is an alert', async ({ page }) => {
  await open(page);
  for (const [kind, text] of [['caution', 'Caution'], ['warning', 'Warning'], ['irreversible', "Can't be undone"], ['unsure', 'Double-check'], ['error', "Couldn't read page 3"]] as const) {
    await expect(page.locator(`[data-kind=${kind}]`).first()).toContainText(text);
  }
  await expect(page.locator('[data-kind=error]')).toHaveAttribute('role', 'alert');
  await expect(page.locator('[data-kind=warning]').first()).toHaveAttribute('role', 'note');
  // each has an icon (svg) as a non-colour cue
  expect(await page.locator('[data-kind=warning] svg').count()).toBeGreaterThan(0);
});

test('progress: progressbar has value and text', async ({ page }) => {
  await open(page);
  const bars = page.getByRole('progressbar');
  const n = await bars.count();
  for (let i = 0; i < n; i++) {
    const b = bars.nth(i);
    await expect(b).toHaveAttribute('aria-valuenow', /\d+/);
    expect(await b.getAttribute('aria-valuetext') ?? await b.getAttribute('aria-label')).toBeTruthy();
  }
});

test('reduced motion: transitions only opacity, sheet has no transform, no looping animation', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/dev/ui');
  const r = await page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.animationName !== 'none' && (cs.animationIterationCount === 'infinite')) bad.push(`${el.className} infinite`);
      if (parseFloat(cs.transitionDuration) > 0.081) bad.push(`${el.className} transition ${cs.transitionDuration}`);
    });
    return bad.slice(0, 5);
  });
  expect(r).toEqual([]);
  await page.getByRole('button', { name: 'Open bottom sheet' }).click();
  const t = await page.locator('dialog.sheet').evaluate((el) => getComputedStyle(el).transform);
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(t);
  await ctx.close();
});

test('data-theme override beats OS scheme both ways', async ({ browser }) => {
  for (const [os, theme, bg] of [['dark', 'light', 'rgb(246, 243, 236)'], ['light', 'dark', 'rgb(20, 19, 16)']] as const) {
    const ctx = await browser.newContext({ colorScheme: os });
    const page = await ctx.newPage();
    await page.goto(`/dev/ui?theme=${theme}`);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(bg);
    // switching back to Auto restores OS scheme
    await page.getByRole('button', { name: 'Auto' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-theme'))).toBe(false);
    await ctx.close();
  }
});
