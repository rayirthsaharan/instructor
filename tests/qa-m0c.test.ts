/* eslint-disable @typescript-eslint/no-explicit-any -- adversarial tests mutate loosely typed JSON */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateGuide, containsQuantity } from '@/lib/guide/validate';
import { orderedSteps, partsForStep, toolsForStep, progressPercentage, phaseForStep, stepsBlockedByMissingParts } from '@/lib/guide/selectors';
import { MockProvider, loadFixtureGuide } from '@/lib/ai/mock';

const FIX = path.resolve(__dirname, '../fixtures');
const valid = (): any => JSON.parse(fs.readFileSync(path.join(FIX, 'lumen-bookcase.guide.json'), 'utf8'));
const opts = { pageCount: 6 };
const run = (g: any) => validateGuide(g, opts);
const ok = (g: any) => {
  const r = run(g);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};

describe('QA M0-c: validator invariants', () => {
  it('(a) every step in an accepted guide has a source on a valid page, even after repairs', () => {
    const g = valid();
    g.steps.s2.sources = [{ pageIndex: 99 }, { pageIndex: -1 }, { pageIndex: 2 }];
    const r = ok(g);
    expect(r.guide.steps.s2!.sources.map((s) => s.pageIndex)).toEqual([2]);
    expect(r.issues.some((i) => i.code === 'source_dropped')).toBe(true);
    for (const bad of [{ pageIndex: 1.5 }, { pageIndex: 6 }, { pageIndex: '2' }, {}]) {
      const h = valid();
      h.steps.s2.sources = [bad];
      expect(run(h).ok).toBe(false);
    }
    expect(validateGuide(valid(), { pageCount: 0 }).ok).toBe(false);
    expect(validateGuide(valid(), { pageCount: Number.NaN }).ok).toBe(false);
  });

  it('(b) manual-origin guidance without a quote is never left as manual, and whitespace-only quote is not accepted', () => {
    const g = valid();
    g.steps.s2.why = { text: 'Because.', origin: 'manual' };
    expect(ok(g).guide.steps.s2!.why!.origin).toBe('inferred');
    const h = valid();
    h.steps.s2.why = { text: 'Because.', origin: 'manual', sourceQuote: '   ' };
    const r = ok(h);
    // a blank quote must not satisfy the verbatim-quote requirement
    expect(r.guide.steps.s2!.why?.origin ?? 'inferred').toBe('inferred');
  });

  it('(c) inferred guidance with digits is removed and reported (all three fields)', () => {
    for (const f of ['why', 'commonMistake', 'checkpoint']) {
      const g = valid();
      g.steps.s3[f] = { text: 'Tighten to 5 Nm.', origin: 'inferred' };
      const r = ok(g);
      expect(r.guide.steps.s3![f as 'why']).toBeUndefined();
      expect(r.issues.some((i) => i.code === 'inferred_quantity_stripped' && i.path === `steps.s3.${f}`)).toBe(true);
    }
  });

  it.each(['Use about ½ the force.', 'Turn it a quarter turn.', 'Use twenty screws.', 'Fifteen minutes should do.', 'Allow a hundred seconds.', 'Use one screw.', 'Use ٣ screws.', 'Tighten to 5 Nm.'])(
    'inferred guidance carrying a quantity is not allowed through: %s',
    (text) => {
      const g = valid();
      g.steps.s3.why = { text, origin: 'inferred' };
      const r = ok(g);
      expect(r.guide.steps.s3!.why, text).toBeUndefined();
    },
  );

  it('(c) a warning with no quote that contains numbers is not silently presented as a quoted fact', () => {
    const g = valid();
    g.steps.s3.warnings = [{ text: 'Do not exceed 20 kg.', severity: 'warning' }];
    const r = ok(g);
    expect(r.guide.steps.s3!.warnings[0]!.interpretedFromDiagram).toBe(true);
    expect(r.guide.steps.s3!.warnings[0]!.text).toBe('Do not exceed 20 kg.');
  });

  it('(d) dangling ids are fatal everywhere', () => {
    const cases: [string, (g: any) => void][] = [
      ['partsUsed', (g) => g.steps.s2.partsUsed.push({ partId: 'ghost' })],
      ['toolsUsed', (g) => g.steps.s2.toolsUsed.push('ghost')],
      ['phaseId', (g) => (g.steps.s2.phaseId = 'ghost')],
      ['phase stepIds', (g) => g.phases[0].stepIds.push('ghost')],
      ['highlight part', (g) => (g.steps.s2.highlights[0].partId = 'ghost')],
    ];
    for (const [name, mut] of cases) {
      const g = valid();
      mut(g);
      expect(run(g).ok, name).toBe(false);
    }
  });

  it('(e) regions: out of range, NaN-like, negative, zero and tiny are never delivered as-is', () => {
    const regions: any[] = [
      { x: -5, y: -5, w: 100, h: 100 },
      { x: 5, y: 5, w: 0.5, h: 0.5 },
      { x: 0.2, y: 0.2, w: 0, h: 0.5 },
      { x: 0.2, y: 0.2, w: -0.1, h: 0.5 },
      { x: 0.2, y: 0.2, w: 0.001, h: 0.5 },
      { x: 0.2, y: 0.2, w: '0.5', h: 0.5 },
      { x: 0.2, y: 0.2, w: 0.5 },
      { x: 1e308, y: 0, w: 1e308, h: 1 },
    ];
    for (const region of regions) {
      const g = valid();
      g.steps.s2.highlights[0].source.region = region;
      const r = run(g);
      if (!r.ok) continue;
      const out = r.guide.steps.s2!.highlights[0]!.source;
      if (out.region) {
        const { x, y, w, h } = out.region;
        expect(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 + 1e-9 && y + h <= 1 + 1e-9, JSON.stringify(region)).toBe(true);
      } else {
        expect(out.regionFallback, JSON.stringify(region)).toBe(true);
      }
    }
  });

  it('(e) Infinity region (not JSON, but possible from in-memory drafts) is dropped, not accepted', () => {
    const g = valid();
    g.steps.s2.highlights[0].source.region = { x: 0, y: 0, w: Infinity, h: 1 };
    const r = run(g);
    if (r.ok) expect(r.guide.steps.s2!.highlights[0]!.source.region).toBeUndefined();
  });

  it('(f) no repair path removes or rewrites a warning (text, severity, quote, count)', () => {
    const g = valid();
    // trigger as many repairs as possible on the step that holds a warning
    g.steps.s7.sources = [{ pageIndex: 99 }, { pageIndex: 4, region: { x: -1, y: -1, w: 9, h: 9 } }];
    g.steps.s7.highlights = [{ source: { pageIndex: 99 } }];
    g.steps.s7.why = { text: 'Because 3 nails.', origin: 'manual' };
    g.steps.s7.sourceQuote = undefined;
    delete g.steps.s7.sourceQuote;
    g.steps.s7.warnings.push({ text: 'Extra, unquoted 5 kg caution.', severity: 'caution' });
    const before = JSON.parse(JSON.stringify(g.steps.s7.warnings));
    const r = ok(g);
    const after = r.guide.steps.s7!.warnings;
    expect(after.length).toBe(before.length);
    after.forEach((w, i) => {
      expect(w.text).toBe(before[i].text);
      expect(w.severity).toBe(before[i].severity);
      expect(w.sourceQuote).toBe(before[i].sourceQuote);
    });
    // all warnings in the fixture survive validate unchanged
    const fx = ok(valid());
    for (const [id, s] of Object.entries<any>(valid().steps)) {
      expect(fx.guide.steps[id]!.warnings.map((w) => [w.text, w.severity, w.sourceQuote])).toEqual(s.warnings.map((w: any) => [w.text, w.severity, w.sourceQuote]));
    }
  });

  it('(f) a quoted warning is never relabelled; invalid severity is rejected, not coerced', () => {
    const g = valid();
    g.steps.s7.warnings[0].severity = 'danger';
    expect(run(g).ok).toBe(false);
    const h = valid();
    h.steps.s7.warnings[0].text = '';
    expect(run(h).ok).toBe(false);
  });

  it('(f) every repair is reported as an issue (diff of output vs input has a matching issue)', () => {
    const g = valid();
    g.steps.s2.why = { text: 'x', origin: 'manual' };
    g.steps.s3.warnings = [{ text: 'Careful', severity: 'caution' }];
    g.steps.s4.sources.push({ pageIndex: 77 });
    g.steps.s4.highlights = [{ source: { pageIndex: 3, region: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } } }];
    const codes = ok(g).issues.map((i) => i.code);
    for (const c of ['manual_without_quote', 'warning_without_quote', 'source_dropped', 'region_clamped']) expect(codes).toContain(c);
  });

  it('(f) stripping a quote from inferred guidance is reported (silent data change otherwise)', () => {
    const g = valid();
    g.steps.s2.why = { text: 'It helps.', origin: 'inferred', sourceQuote: 'Some quote' };
    const r = ok(g);
    expect(r.guide.steps.s2!.why!.sourceQuote).toBeUndefined();
    expect(r.issues.some((i) => i.path === 'steps.s2.why')).toBe(true);
  });

  it('(g) prototype-pollution style keys do not pollute and do not yield extra steps', () => {
    const raw = fs.readFileSync(path.join(FIX, 'lumen-bookcase.guide.json'), 'utf8');
    const polluted = raw.replace('"steps": {', '"steps": {"__proto__": {"polluted": true}, "constructor": {"x": 1},');
    const g = JSON.parse(polluted);
    const r = run(g);
    expect(({} as any).polluted).toBeUndefined();
    if (r.ok) {
      expect(Object.keys(r.guide.steps).sort()).toEqual(Object.keys(valid().steps).sort());
      expect((Object.prototype as any).polluted).toBeUndefined();
    }
    const h = JSON.parse(raw);
    h.__proto__ = { schemaVersion: 1 };
    h.constructor = { prototype: { polluted: true } };
    run(h);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('(g) unknown extra fields never reach the UI', () => {
    const g = valid();
    g.evil = '<script>';
    g.steps.s2.html = '<img onerror=x>';
    g.steps.s2.sources[0].extra = 1;
    g.parts[0].extra = { a: 1 };
    const r = ok(g);
    expect(JSON.stringify(r.guide)).not.toMatch(/evil|onerror|extra/);
  });

  it('(h) duplicate ids and structural degeneracy', () => {
    const dupPhase = valid();
    dupPhase.phases.push({ ...dupPhase.phases[0], stepIds: [] });
    expect(run(dupPhase).ok).toBe(false);
    const dupTool = valid();
    dupTool.tools.push({ ...dupTool.tools[0] });
    expect(run(dupTool).ok).toBe(false);
    const twoPhases = valid();
    twoPhases.phases[1].stepIds.push('s1');
    expect(run(twoPhases).ok).toBe(false);
    const twiceSame = valid();
    twiceSame.phases[0].stepIds.push('s1');
    expect(run(twiceSame).ok).toBe(false);
  });

  it('(h) an empty phase is rejected (UI would render a section with no steps)', () => {
    const g = valid();
    g.phases.push({ id: 'empty', title: 'Nothing', stepIds: [] });
    expect(run(g).ok).toBe(false);
  });

  it('(h) a guide with zero steps is rejected', () => {
    const g = valid();
    g.steps = {};
    g.phases = [{ id: 'p', title: 'P', stepIds: [] }];
    expect(run(g).ok).toBe(false);
  });

  it('(h) huge input is handled in bounded time (and ideally bounded by a limit)', () => {
    const g = valid();
    const base = g.steps.s2;
    g.phases = [{ id: 'p', title: 'P', stepIds: [] }];
    g.steps = {};
    for (let i = 0; i < 3000; i++) {
      g.steps[`x${i}`] = { ...base, id: `x${i}`, phaseId: 'p' };
      g.phases[0].stepIds.push(`x${i}`);
    }
    const t = Date.now();
    run(g);
    expect(Date.now() - t).toBeLessThan(5000);
  });

  it('(h) a single enormous text field is bounded', () => {
    const g = valid();
    g.steps.s2.instruction = 'a'.repeat(5_000_000);
    expect(run(g).ok, 'no max length on text fields: 5MB instruction accepted').toBe(false);
  });

  it('numbers without a quote: title digits and spelled numbers downgrade; quoted step keeps confidence', () => {
    const g = valid();
    g.steps.s6.title = 'Add 2 sides';
    const r = ok(g);
    expect(r.guide.steps.s6!.confidence).toBe('low');
    expect(r.issues.some((i) => i.code === 'numbers_without_quote' && i.path === 'steps.s6')).toBe(true);
    expect(ok(valid()).guide.steps.s2!.confidence).toBe('high');
  });

  it('numbers in a step warning-less/quote-less instruction using unicode digits or fractions still downgrade', () => {
    for (const t of ['Turn ½ a turn.', 'Use ① screw.', 'Use twenty screws.', 'Fit 4​ screws']) {
      const g = valid();
      g.steps.s6.instruction = t;
      expect(ok(g).guide.steps.s6!.confidence, t).toBe('low');
    }
  });

  it('migrateGuide/validateGuide reject unknown versions and odd values', () => {
    for (const v of [0, 2, -1, 1.5, '1', null, undefined, NaN, true]) {
      const g = valid();
      g.schemaVersion = v;
      const r = run(g);
      expect(r.ok, String(v)).toBe(false);
    }
    for (const bad of [null, undefined, [], 'x', 1]) expect(run(bad).ok).toBe(false);
  });

  it('containsQuantity sanity', () => {
    expect(containsQuantity('tighten')).toBe(false);
    expect(containsQuantity('tighten 5')).toBe(true);
    expect(containsQuantity('Phone')).toBe(false); // "one" inside a word
  });
});

describe('QA M0-c: fixture consistency with SVG pages', () => {
  const pages = [1, 2, 3, 4, 5, 6].map((n) => fs.readFileSync(path.join(FIX, `lumen-bookcase/page-${n}.svg`), 'utf8').replace(/&amp;/g, '&'));
  const g = valid();

  it('part labels, names and quantities match the parts page', () => {
    const t = pages[1]!;
    for (const p of g.parts) {
      const re = new RegExp(`>${p.manualLabel}<[\\s\\S]*?>${p.name.replace(/^Wooden /, 'Wooden ')}<[\\s\\S]*?>x${p.quantity}<`);
      expect(re.test(t), `${p.id}`).toBe(true);
    }
  });

  it('per-step part quantities add up to the stocked quantity and numbers in instructions are on the page', () => {
    const used: Record<string, number> = {};
    for (const s of Object.values<any>(g.steps)) for (const pu of s.partsUsed) used[pu.partId] = (used[pu.partId] ?? 0) + (pu.quantity ?? 0);
    for (const p of g.parts) if (used[p.id]) expect(used[p.id], p.id).toBeLessThanOrEqual(p.quantity);
    for (const s of Object.values<any>(g.steps)) {
      const text = s.sources.map((x: any) => pages[x.pageIndex]).join(' ');
      for (const num of s.instruction.match(/\d+/g) ?? []) expect(text, `${s.id} number ${num}`).toContain(num);
    }
  });

  it('instruction wording is supported by the source page (no invented hardware details at high confidence)', () => {
    // s4 mentions an arrow on the cam lock, which appears nowhere in the manual pages
    const s4 = g.steps.s4;
    const mentionsArrow = /arrow/i.test(s4.instruction);
    const onPage = pages.some((p) => /arrow/i.test(p));
    expect(mentionsArrow && !onPage && s4.confidence === 'high').toBe(false);
  });

  it('every warning on a source page is represented in the guide (safety text not dropped)', () => {
    const all = JSON.stringify(g);
    for (const p of pages) {
      for (const m of p.matchAll(/>((?:WARNING|CAUTION): [^<]+)</g)) expect(all, m[1]).toContain(m[1]!);
    }
  });

  it('loadFixtureGuide equals validateGuide output (mock serves only validated data)', () => {
    const r = ok(valid());
    expect(loadFixtureGuide()).toEqual(r.guide);
  });
});

describe('QA M0-c: selectors on edge inputs', () => {
  const guide = loadFixtureGuide();

  it('unknown ids are inert', () => {
    expect(partsForStep(guide, 'nope')).toEqual([]);
    expect(toolsForStep(guide, 'nope')).toEqual([]);
    expect(phaseForStep(guide, 'nope')).toBeUndefined();
    expect(progressPercentage(guide, [])).toBe(0);
    expect(progressPercentage(guide, ['nope', 's1', 's1'])).toBe(10);
    expect(progressPercentage(guide, Object.keys(guide.steps))).toBe(100);
    expect(stepsBlockedByMissingParts(guide, [])).toEqual([]);
    expect(stepsBlockedByMissingParts(guide, ['nail']).map((s) => s.id)).toEqual(['s7']);
    expect(orderedSteps(guide).length).toBe(10);
  });

  it('prototype-property ids (from corrupt stored progress) do not count or crash', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(progressPercentage(guide, [id]), id).toBe(0);
      expect(() => partsForStep(guide, id), id).not.toThrow();
      expect(partsForStep(guide, id)).toEqual([]);
      expect(toolsForStep(guide, id)).toEqual([]);
    }
  });

  it('progress is clamped to 0..100 with many junk ids', () => {
    const p = progressPercentage(guide, ['constructor', 'toString', 'valueOf', ...Object.keys(guide.steps)]);
    expect(p).toBeLessThanOrEqual(100);
  });
});

describe('QA M0-c: mock provider', () => {
  const guide = loadFixtureGuide();
  const pages: any[] = [];

  it('default draft validates with no issues; custom bad draft is rejected by validateGuide (provider does not launder)', async () => {
    const r = await new MockProvider().analyseDocument({ pages });
    expect(r.kind).toBe('guide');
    if (r.kind === 'guide') expect(ok(r.draft).issues).toEqual([]);
    const bad = valid();
    bad.steps.s2.sources = [{ pageIndex: 50 }];
    const r2 = await new MockProvider({ draft: bad }).analyseDocument({ pages });
    if (r2.kind === 'guide') expect(run(r2.draft).ok).toBe(false);
  });

  it('draft is a fresh clone each call (callers cannot corrupt the fixture)', async () => {
    const p = new MockProvider();
    const a: any = (await p.analyseDocument({ pages })) as any;
    a.draft.title = 'MUTATED';
    const b: any = (await p.analyseDocument({ pages })) as any;
    expect(b.draft.title).not.toBe('MUTATED');
  });

  it('abort before and during analysis rejects with code aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(new MockProvider().analyseDocument({ pages, signal: ac.signal })).rejects.toMatchObject({ code: 'aborted' });
    const ac2 = new AbortController();
    const pr = new MockProvider({ delayMs: 500 }).analyseDocument({ pages, signal: ac2.signal });
    setTimeout(() => ac2.abort(), 20);
    await expect(pr).rejects.toMatchObject({ code: 'aborted' });
  });

  it('answers are grounded with a citation on a valid page, ungrounded questions have none, and empty/hostile input is safe', async () => {
    const p = new MockProvider();
    for (const message of ['how many nails do I need', 'what is the weather', '', '   ', '<script>alert(1)</script>', 'constructor __proto__', 'x'.repeat(100000)]) {
      const events: any[] = [];
      for await (const e of p.answerQuestion({ guide, message })) events.push(e);
      const done = events.at(-1);
      expect(done.type).toBe('done');
      if (done.grounded) {
        expect(done.citations.length).toBeGreaterThan(0);
        for (const c of done.citations) {
          expect(guide.steps[c.stepId]).toBeDefined();
          expect(c.pageIndex).toBeLessThan(6);
        }
      } else expect(done.citations).toEqual([]);
    }
  });

  it('a question about a warning topic quotes the manual verbatim, not a paraphrase', async () => {
    const events: any[] = [];
    for await (const e of new MockProvider().answerQuestion({ guide, message: 'can I take the back panel off after nailing' })) events.push(e);
    const text = events.filter((e) => e.type === 'text').map((e) => e.delta).join('');
    expect(text).toContain('WARNING: Once nailed, the back panel cannot be removed without damage.');
  });

  it('simplifyStep: unknown and prototype ids give a controlled AIProviderError, never a TypeError', async () => {
    const p = new MockProvider();
    for (const stepId of ['nope', 'constructor', 'toString']) {
      await expect(p.simplifyStep({ guide, stepId, level: 'simpler' })).rejects.toMatchObject({ name: 'AIProviderError' });
    }
  });

  it('simplifyStep never drops a number from a quoted instruction (simplest keeps first sentence only)', async () => {
    const p = new MockProvider();
    const r = await p.simplifyStep({ guide, stepId: 's7', level: 'simplest' });
    // s7 instruction: the 16 nails quantity lives in sentence two; simplification must not silently lose it
    expect(r.text).toMatch(/16/);
  });

  it('verifyGuide returns a validate-able draft and does not alias the input', async () => {
    const r = await new MockProvider().verifyGuide({ guide, pages });
    expect(r.draft).toEqual(guide);
    expect(r.draft).not.toBe(guide);
    expect(ok(r.draft).issues).toEqual([]);
  });
});
