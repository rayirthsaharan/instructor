import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/lumen-bookcase.guide.json';
import { MockProvider } from '../src/lib/ai/mock';
import { validateGuide } from '../src/lib/guide/validate';
import type { AnthropicLike } from '../src/lib/ai/anthropic';
import { ALLOWED_MODEL, BudgetExceededError, BudgetGuard, CostLog, CostLogSink, guardedClient, ModelNotAllowedError, worstCaseUsd } from '../scripts/accuracy/budget';
import { runMatrix } from '../scripts/accuracy/harness';
import { parseAnswerKey } from '../scripts/accuracy/key-schema';
import { loadLumen, MANUALS, orderPanels, svgPagePanels } from '../scripts/accuracy/manuals';
import { buildMatrix, projectMatrix, VARIANTS } from '../scripts/accuracy/matrix';
import { splitTokenCounts } from '../scripts/accuracy/run';
import { classifyRegion, passBar, scoreGuide } from '../scripts/accuracy/score';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'accuracy-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const lumen = loadLumen();
type Draft = typeof fixture;
const draft = (): Draft => structuredClone(fixture);
const validated = (d: unknown) => {
  const r = validateGuide(d, { pageCount: 6, pageTexts: lumen.pageTexts });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.guide;
};
const panels = new Map(lumen.panels!.map((p) => [p.pageIndex, p.panels]));

describe('answer key', () => {
  it('parses the Lumen control key', () => {
    expect(lumen.key.steps).toHaveLength(8);
    expect(lumen.key.warnings).toHaveLength(5);
  });

  it('rejects a key whose steps point at unknown parts or pages', () => {
    const bad = structuredClone(lumen.key) as { steps: { pageIndex: number; partsUsed: { part: string }[] }[] };
    bad.steps[0]!.partsUsed.push({ part: 'Z' });
    bad.steps[1]!.pageIndex = 40;
    expect(() => parseAnswerKey(bad)).toThrow(/unknown part "Z".*page 40/);
  });
});

describe('Lumen loader', () => {
  it('loads 6 page images, the page text and the dashed panel frames in reading order', () => {
    expect(lumen.pages).toHaveLength(6);
    expect(lumen.pageTexts[5]).toContain('WARNING: Attach the wall strap.');
    const p3 = panels.get(2)!;
    expect(p3.map((p) => p.panelId)).toEqual(['p3-a', 'p3-b']);
    expect(p3[0]!.region).toEqual({ x: 0.05, y: 0.14, w: 0.9, h: 0.38 });
    expect(panels.get(1)!.map((p) => p.panelId)).toEqual(['p2-a', 'p2-b', 'p2-c', 'p2-d', 'p2-e', 'p2-f', 'p2-g', 'p2-h', 'p2-i']);
    expect(panels.has(0)).toBe(false);
  });

  it('orders panels by rows, then left to right', () => {
    const r = (x: number, y: number) => ({ x, y, w: 0.1, h: 0.1 });
    expect(orderPanels([r(0.5, 0.51), r(0.1, 0.5), r(0.1, 0.1)])).toEqual([r(0.1, 0.1), r(0.1, 0.5), r(0.5, 0.51)]);
  });

  it('ignores SVG rects without a dash pattern', () => {
    const svg = '<svg viewBox="0 0 100 200"><rect x="0" y="0" width="100" height="200" fill="#fff"/><rect x="10" y="20" width="50" height="40" stroke-dasharray="2 2"/></svg>';
    expect(svgPagePanels(svg, 0)).toEqual([{ panelId: 'p1-a', region: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 } }]);
  });

  it('lists three selected manuals plus the control, all reachable from one host', () => {
    expect(MANUALS.map((m) => m.kind).sort()).toEqual(['control', 'mixed', 'picture-led assembly', 'text-heavy device setup']);
    for (const m of MANUALS.filter((x) => x.id !== 'lumen')) expect(m.hosts).toEqual(['raw.githubusercontent.com']);
  });
});

describe('region scoring', () => {
  const step = lumen.key.steps[0]!; // page 2, x .05 y .14 w .9 h .38
  it('accepts the right panel, by region or by panel id alone', () => {
    expect(classifyRegion({ pageIndex: 2, region: step.region, regionFallback: false }, step)).toBe('correct');
    expect(classifyRegion({ pageIndex: 2, panelId: 'p3-a', regionFallback: false }, step, panels)).toBe('correct');
  });
  it('separates safe outcomes from wrong ones', () => {
    expect(classifyRegion({ pageIndex: 2, regionFallback: true }, step)).toBe('fallback');
    expect(classifyRegion({ pageIndex: 2, region: { x: 0, y: 0, w: 1, h: 1 }, regionFallback: false }, step)).toBe('coarse');
    expect(classifyRegion({ pageIndex: 2, region: { x: 0.04, y: 0.12, w: 0.92, h: 0.42 }, regionFallback: true }, step)).toBe('approximate');
    expect(classifyRegion({ pageIndex: 2, panelId: 'p3-b', regionFallback: false }, step, panels)).toBe('wrong');
    expect(classifyRegion({ pageIndex: 3, region: step.region, regionFallback: false }, step)).toBe('wrong');
    expect(classifyRegion({ pageIndex: 2, region: { x: 0.05, y: 0.54, w: 0.9, h: 0.38 }, regionFallback: true }, step)).toBe('wrong');
  });
});

describe('guide scoring', () => {
  it('scores the fixture guide as a pass against its own manual', () => {
    const s = scoreGuide(validated(draft()), lumen.key, { pageTexts: lumen.pageTexts, panels });
    expect(s.parts).toMatchObject({ matched: 9, invented: [], quantityErrors: [], missed: [] });
    expect(s.steps).toMatchObject({ mapped: 8, missed: [], orderErrors: 0 });
    expect(s.steps.extra.sort()).toEqual(['s1', 's10']);
    expect(s.warnings).toMatchObject({ verbatim: 5, missing: [], paraphrasedOnly: [] });
    expect(s.regions).toMatchObject({ correct: 8, wrong: 0, correctShare: 1 });
    expect(s.inventedQuantities).toEqual([]);
    expect(passBar(s)).toEqual({ pass: true, reasons: [] });
  });

  it('catches invented parts, wrong quantities, lost warnings, wrong regions and step order', () => {
    const d = draft();
    d.parts.push({ id: 'glue', name: 'Wood glue', quantity: 1, source: { pageIndex: 1, regionFallback: true } } as unknown as Draft['parts'][number]);
    d.parts.find((p) => p.id === 'nail')!.quantity = 12;
    const s7 = d.steps.s7 as { warnings: { sourceQuote?: string; text: string }[] };
    s7.warnings = [];
    const s3 = d.steps.s3 as { sources: unknown[] };
    s3.sources = [{ pageIndex: 2, panelId: 'p3-a', region: { x: 0.05, y: 0.14, w: 0.9, h: 0.38 }, regionFallback: false }];
    const frame = d.phases.find((p) => p.id === 'frame')!;
    frame.stepIds = ['s6', 's5', 's4'];
    const s = scoreGuide(validated(d), lumen.key, { pageTexts: lumen.pageTexts, panels });
    expect(s.parts.invented).toEqual(['Wood glue']);
    expect(s.parts.quantityErrors).toEqual(['H: 12 instead of 16']);
    expect(s.warnings.missing).toEqual(['WARNING: Once nailed, the back panel cannot be removed without damage.']);
    expect(s.regions.wrong).toBe(1);
    expect(s.steps.orderErrors).toBe(2);
    const v = passBar(s);
    expect(v.pass).toBe(false);
    expect(v.reasons.join(' | ')).toMatch(/invented parts.*quantity errors.*warnings not verbatim.*wrong diagram region.*right region on 88%/);
  });

  it('reports a warning kept only as paraphrase, and a measurement that is not in the manual', () => {
    const d = draft();
    const w = (d.steps.s9 as { warnings: { sourceQuote?: string; text: string }[] }).warnings[0]!;
    delete w.sourceQuote;
    w.text = 'WARNING: Attach the wall strap. An unsecured bookcase can tip over and cause serious injury.';
    (d.steps.s6 as { instruction: string }).instruction = 'Lower the top panel (B) onto the dowels and tap it 3 times.';
    const s = scoreGuide(validated(d), lumen.key, { pageTexts: lumen.pageTexts, panels });
    expect(s.warnings.paraphrasedOnly).toHaveLength(1);
    expect(s.inventedQuantities).toEqual(['3']);
  });

  it('cannot judge invented measurements without page text, and says so', () => {
    const s = scoreGuide(validated(draft()), lumen.key, { panels });
    expect(s.inventedQuantities).toBeNull();
    expect(passBar(s).reasons).toContain('invented measurements not measurable (no page text)');
  });
});

describe('budget guard', () => {
  const usage = { callType: 'analyse' as const, model: ALLOWED_MODEL, inputTokens: 40_000, outputTokens: 20_000, cacheReadTokens: 0, cacheWriteTokens: 0 };

  it('prices each response from its usage and sums the log across runs', () => {
    const log = new CostLog(join(dir, 'cost-log.jsonl'));
    const sink = new CostLogSink(log, () => new Date('2026-11-13T00:00:00Z'));
    sink.context = { runId: 'b/lumen/panels/1', manualId: 'lumen', variant: 'panels', repeat: 1 };
    sink.record(usage); // 40K x $0.10 + 20K x $0.50 per M = $0.014
    sink.record({ ...usage, inputTokens: 120_000, outputTokens: 1_000 }); // long-prompt tier: 120K x $0.50 + 1K x $2.50 per M = $0.0625
    expect(log.entries()).toHaveLength(2);
    expect(log.entries()[0]).toMatchObject({ runId: 'b/lumen/panels/1', ts: '2026-11-13T00:00:00.000Z' });
    expect(new CostLog(log.path).spentUsd()).toBeCloseTo(0.0765, 6);
  });

  it('refuses a cap above $10 and stops before a call that would cross the cap', () => {
    const log = new CostLog(join(dir, 'cost-log.jsonl'));
    expect(() => new BudgetGuard(log, 10.01)).toThrow(/D-025/);
    const guard = new BudgetGuard(log, 0.02);
    new CostLogSink(log).record(usage); // $0.014 spent
    expect(() => guard.assertCanSpend(0.005, 'x')).not.toThrow();
    expect(() => guard.assertCanSpend(0.007, 'run y')).toThrow(BudgetExceededError);
  });

  function fakeClient(inputTokens = 30_000) {
    const calls: string[] = [];
    const message = { usage: { input_tokens: 1, output_tokens: 1 }, content: [] };
    const inner = {
      messages: {
        countTokens: vi.fn(async () => (calls.push('count'), { input_tokens: inputTokens })),
        create: vi.fn(async () => (calls.push('create'), message)),
        stream: vi.fn(() => {
          calls.push('stream');
          return { finalMessage: async () => message, abort: () => undefined, async *[Symbol.asyncIterator]() {} };
        }),
      },
    };
    return { inner: inner as unknown as AnthropicLike, calls };
  }
  const params = (model: string, max_tokens: number) => ({ model, max_tokens, messages: [{ role: 'user' as const, content: 'x' }] });

  it('lets only claude-haiku-5-5 through, before anything is sent', async () => {
    const { inner, calls } = fakeClient();
    const c = guardedClient(inner, new BudgetGuard(new CostLog(join(dir, 'l.jsonl')), 10));
    await expect(c.messages.create(params('claude-sonnet-5-5', 100))).rejects.toThrow(ModelNotAllowedError);
    await expect(c.messages.countTokens({ model: 'claude-opus-5-5', messages: [] })).rejects.toThrow(ModelNotAllowedError);
    await expect(c.messages.stream(params('claude-opus-5-5', 100)).finalMessage()).rejects.toThrow(ModelNotAllowedError);
    expect(calls).toEqual([]);
  });

  it('counts tokens, then sends only when the worst case fits', async () => {
    const { inner, calls } = fakeClient(30_000);
    const worst = worstCaseUsd(30_000, 64_000); // (31,500 + 2,000) x $0.10 + 64K x $0.50 per M ~ $0.0354
    const c = guardedClient(inner, new BudgetGuard(new CostLog(join(dir, 'l.jsonl')), Math.max(worst - 0.001, 0.001)));
    await expect(c.messages.stream(params(ALLOWED_MODEL, 64_000)).finalMessage()).rejects.toThrow(BudgetExceededError);
    expect(calls).toEqual(['count']);
    const ok = guardedClient(inner, new BudgetGuard(new CostLog(join(dir, 'l2.jsonl')), 10));
    const s = ok.messages.stream(params(ALLOWED_MODEL, 64_000));
    for await (const _ of s) void _;
    await s.finalMessage();
    await ok.messages.create(params(ALLOWED_MODEL, 2_000));
    expect(calls).toEqual(['count', 'count', 'stream', 'count', 'create']);
  });
});

describe('run matrix and projection', () => {
  it('has the planned shape and stays far under the cap even in the worst case', () => {
    const runs = buildMatrix(MANUALS.map((m) => ({ id: m.id, pages: m.pages })));
    expect(runs).toHaveLength(4 * VARIANTS.reduce((s, v) => s + v.repeats, 0));
    expect(runs).toHaveLength(28);
    const p = projectMatrix(runs);
    expect(p.expectedUsd).toBeGreaterThan(0.3);
    expect(p.expectedUsd).toBeLessThan(1.5);
    expect(p.worstUsd).toBeLessThan(3);
  });

  it('separates prompt overhead from per-page tokens (phase 0)', () => {
    // prompt 4,000; pages 2,000 / 2,500 / 3,000
    expect(splitTokenCounts([6_000, 6_500, 7_000], 11_500)).toEqual({ promptOverhead: 4_000, perPage: [2_000, 2_500, 3_000], perPageMax: 3_000 });
  });
});

describe('harness with the mock provider', () => {
  it('runs Lumen through analysis, verification, validation and scoring and writes results and a cost log', async () => {
    const log = new CostLog(join(dir, 'cost-log.jsonl'));
    let t = 0;
    const out = await runMatrix({
      manuals: [lumen],
      variants: VARIANTS,
      repeats: 1,
      providerFor: () => new MockProvider(),
      log,
      sink: new CostLogSink(log),
      guard: new BudgetGuard(log, 10),
      outDir: dir,
      batchId: 'test-batch',
      now: () => (t += 1000),
    });
    expect(out.stoppedForBudget).toBe(false);
    expect(out.results.map((r) => [r.variant, r.status, r.verdict.pass])).toEqual([
      ['panels', 'scored', true],
      ['no-panels', 'scored', true],
      ['panels-small-chunks', 'scored', true],
    ]);
    expect(out.results.every((r) => r.costUsd === 0)).toBe(true);
    const md = readFileSync(out.resultsMd, 'utf8');
    expect(md).toContain('| lumen | panels | 1 | scored | 9/9 | 0 | 0 | 8/8 | 0 | 5/5 | 8/0/0/0/0/0 | 100% | 0 | 0.0000 | 1.0 | yes |');
    expect(md).toContain('| lumen | panels | 1 | yes | 100% | 0.0000 |');
    expect(JSON.parse(readFileSync(out.resultsJson, 'utf8'))).toHaveLength(3);
  });

  it('skips panel variants when a manual has no detected panels, and records rejected drafts', async () => {
    const log = new CostLog(join(dir, 'cost-log.jsonl'));
    const out = await runMatrix({
      manuals: [{ ...lumen, panels: undefined }],
      variants: VARIANTS.filter((v) => v.id !== 'panels-small-chunks'),
      repeats: 1,
      providerFor: (v) => new MockProvider(v.id === 'no-panels' ? { draft: { not: 'a guide' } } : {}),
      log,
      sink: new CostLogSink(log),
      guard: new BudgetGuard(log, 10),
      outDir: dir,
      batchId: 'b2',
    });
    expect(out.results.map((r) => r.status)).toEqual(['skipped', 'rejected_analysis']);
    expect(out.results.every((r) => !r.verdict.pass)).toBe(true);
  });

  it('stops the whole batch when a paid run would cross the cap', async () => {
    const log = new CostLog(join(dir, 'cost-log.jsonl'));
    const paid = Object.assign(new MockProvider(), { isMock: false as const });
    const out = await runMatrix({
      manuals: [lumen],
      variants: VARIANTS,
      repeats: 1,
      providerFor: () => paid as unknown as MockProvider,
      log,
      sink: new CostLogSink(log),
      guard: new BudgetGuard(log, 0.01),
      outDir: dir,
      batchId: 'b3',
    });
    expect(out.stoppedForBudget).toBe(true);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.status).toBe('budget_stop');
  });
});
