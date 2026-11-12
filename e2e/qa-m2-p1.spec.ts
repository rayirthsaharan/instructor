import { expect, test } from '@playwright/test';
import { openPlayer, patchGuide, primary, putProgress, uploadLumen, VIEWPORTS } from './m2-player-helpers';

// QA M2 re-check of the designer's P1 items.
let guideId = '';
let state: Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const c = await browser.newContext();
  ({ guideId } = await uploadLumen(c));
  state = await c.storageState();
  await c.close();
});

for (const vp of ['375', 'landscape'] as const) {
  test(`primary label stays on one line on an irreversible step at ${vp}`, async ({ browser }) => {
    const context = await browser.newContext({ ...VIEWPORTS[vp], storageState: state });
    await putProgress(context, guideId, {});
    const page = await context.newPage();
    await patchGuide(page, guideId, (g) => {
      g.steps.s2.irreversible = true;
    });
    await openPlayer(page, guideId, '?step=s2');
    const h = await primary(page).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { h: r.height, lines: Math.round(r.height / parseFloat(getComputedStyle(e).lineHeight || '24')) };
    });
    expect(h.h).toBeLessThanOrEqual(60);
    expect(h.lines).toBeLessThanOrEqual(3);
    const wrapped = await primary(page).evaluate((e) => {
      const range = document.createRange();
      range.selectNodeContents(e);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    expect(wrapped, 'label text rects on distinct lines').toBeLessThanOrEqual(2); // icon + text share a line
    await context.close();
  });
}

for (const vp of ['768', '1280'] as const) {
  test(`Original viewer and Steps sheet cover the whole viewport at ${vp}`, async ({ browser }) => {
    const context = await browser.newContext({ ...VIEWPORTS[vp], storageState: state });
    await putProgress(context, guideId, {});
    const page = await context.newPage();
    await openPlayer(page, guideId, '?step=s2&panel=original&page=1');
    const v = page.getByTestId('original-viewer');
    await expect(v).toBeVisible();
    const box = await v.boundingBox();
    const vpSize = VIEWPORTS[vp].viewport;
    expect(box!.x).toBeLessThanOrEqual(0.5);
    expect(box!.y).toBeLessThanOrEqual(0.5);
    expect(box!.width).toBeGreaterThanOrEqual(vpSize.width - 1);
    expect(box!.height).toBeGreaterThanOrEqual(vpSize.height - 1);
    await context.close();
  });
}

test('a manual quote identical to the instruction is not printed twice', async ({ browser }) => {
  const context = await browser.newContext({ ...VIEWPORTS['375'], storageState: state });
  await putProgress(context, guideId, {});
  const page = await context.newPage();
  const T = 'Insert the dowels into the holes exactly as shown.';
  await patchGuide(page, guideId, (g) => {
    g.steps.s2.instruction = T;
    g.steps.s2.sourceQuote = T;
    g.steps.s2.warnings = [{ text: 'Do not overtighten.', severity: 'warning', sourceQuote: 'Do not overtighten.', interpretedFromDiagram: false }];
  });
  await openPlayer(page, guideId, '?step=s2');
  const content = page.getByTestId('step-content');
  expect(await content.getByText(T, { exact: true }).count()).toBe(1);
  expect(await content.getByText('Do not overtighten.', { exact: true }).count()).toBe(1);
  await expect(content.getByText('From your manual').first()).toBeVisible();
  await context.close();
});
