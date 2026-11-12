/* eslint-disable @typescript-eslint/no-explicit-any -- tests mutate loosely typed JSON */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateGuide, containsQuantity } from '@/lib/guide/validate';
import { migrateGuide } from '@/lib/guide/schema';

const FIX = path.resolve(__dirname, '../fixtures');
const load = (rel: string): any => JSON.parse(fs.readFileSync(path.join(FIX, rel), 'utf8'));
const valid = () => load('lumen-bookcase.guide.json');
const pageTexts = [1, 2, 3, 4, 5, 6].map((n) =>
  fs.readFileSync(path.join(FIX, `lumen-bookcase/page-${n}.svg`), 'utf8').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
);
const opts: { pageCount: number; pageTexts?: string[] } = { pageCount: 6, pageTexts };

function ok(raw: unknown, o = opts) {
  const r = validateGuide(raw, o);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
}
function fail(raw: unknown, o = opts) {
  const r = validateGuide(raw, o);
  if (r.ok) throw new Error('expected failure');
  return r.errors;
}

describe('fixture', () => {
  it('passes with no issues and has the planned shape', () => {
    const { guide, issues } = ok(valid());
    expect(issues).toEqual([]);
    expect(Object.keys(guide.steps)).toHaveLength(10);
    expect(guide.phases).toHaveLength(3);
    expect(guide.steps.s7!.irreversible).toBe(true);
    expect(guide.steps.s8!.confidence).toBe('low');
    expect(guide.steps.s4!.interpretedFromDiagram).toBe(true);
    const fallbacks = Object.values(guide.steps).flatMap((s) => s.highlights).filter((h) => h.source.regionFallback);
    expect(fallbacks.length).toBeGreaterThan(0);
  });

  it('has six page images and every quote appears on a page of its step', () => {
    const pages = [0, 1, 2, 3, 4, 5].map((i) => fs.readFileSync(path.join(FIX, `lumen-bookcase/page-${i + 1}.svg`), 'utf8'));
    const g = valid();
    const unesc = (s: string) => s.replace(/&amp;/g, '&');
    for (const step of Object.values<any>(g.steps)) {
      const text = step.sources.map((s: any) => unesc(pages[s.pageIndex]!)).join(' ');
      const quotes = [step.sourceQuote, ...step.warnings.map((w: any) => w.sourceQuote), step.checkpoint?.sourceQuote].filter(Boolean);
      for (const q of quotes) expect(text, `${step.id}: ${q}`).toContain(q);
    }
  });

  it('accepts a round trip through validate (idempotent)', () => {
    const first = ok(valid()).guide;
    expect(ok(first).guide).toEqual(first);
  });
});

describe('invalid fixtures', () => {
  it('unresolved part id', () => {
    expect(fail(load('invalid/unresolved-part.guide.json'), { pageCount: 2 }).map((e) => e.code)).toContain('unknown_part');
  });
  it('phase missing a step', () => {
    expect(fail(load('invalid/phase-missing-step.guide.json'), { pageCount: 2 }).map((e) => e.code)).toContain('step_not_in_phase');
  });
  it('step source on a page that does not exist', () => {
    expect(fail(load('invalid/bad-source-page.guide.json'), { pageCount: 2 }).map((e) => e.code)).toContain('no_valid_source');
  });
});

describe('schema versioning', () => {
  it('migrateGuide accepts the current version and rejects others', () => {
    expect(migrateGuide({ schemaVersion: 1 }).ok).toBe(true);
    expect(migrateGuide({ schemaVersion: 2 }).ok).toBe(false);
    expect(migrateGuide({ schemaVersion: 0 }).ok).toBe(false);
    expect(migrateGuide({}).ok).toBe(false);
    expect(migrateGuide(null).ok).toBe(false);
  });
  it('validateGuide reports a bad version and non-objects as fatal', () => {
    expect(fail({ ...valid(), schemaVersion: 9 })[0]!.code).toBe('schema_version');
    expect(fail('nope')[0]!.code).toBe('schema_version');
  });
  it('reports schema errors with paths', () => {
    const g = valid();
    g.difficulty = 7;
    const errs = fail(g);
    expect(errs[0]).toMatchObject({ code: 'schema', path: 'difficulty' });
  });
  it('does not mutate its input', () => {
    const g = valid();
    g.steps.s2.sources[0].region = { x: -1, y: 0, w: 5, h: 0.5 };
    const copy = structuredClone(g);
    ok(g);
    expect(g).toEqual(copy);
  });
});

describe('id resolution', () => {
  it('unknown tool', () => {
    const g = valid();
    g.steps.s3.toolsUsed = ['laser'];
    expect(fail(g).map((e) => e.code)).toContain('unknown_tool');
  });
  it('unknown phase and mismatched phase', () => {
    const g = valid();
    g.steps.s1.phaseId = 'nope';
    g.steps.s4.phaseId = 'prepare';
    const codes = fail(g).map((e) => e.code);
    expect(codes).toContain('unknown_phase');
    expect(codes).toContain('phase_mismatch');
  });
  it('highlight with an unknown part', () => {
    const g = valid();
    g.steps.s2.highlights[0].partId = 'ghost';
    expect(fail(g).map((e) => e.code)).toContain('unknown_part');
  });
  it('duplicate part ids', () => {
    const g = valid();
    g.parts.push({ ...g.parts[0] });
    expect(fail(g).map((e) => e.code)).toContain('duplicate_id');
  });
  it('step key must equal step id', () => {
    const g = valid();
    g.steps.s1.id = 'other';
    expect(fail(g).map((e) => e.code)).toContain('step_key_mismatch');
  });
});

describe('phases', () => {
  it('a step in no phase', () => {
    const g = valid();
    g.phases[0].stepIds = ['s1', 's2'];
    expect(fail(g).map((e) => e.code)).toContain('step_not_in_phase');
  });
  it('a step listed twice', () => {
    const g = valid();
    g.phases[1].stepIds.push('s1');
    expect(fail(g).map((e) => e.code)).toContain('step_repeated');
  });
  it('a phase lists an unknown step', () => {
    const g = valid();
    g.phases[1].stepIds.push('s99');
    expect(fail(g).map((e) => e.code)).toContain('unknown_step');
  });
});

describe('sources and pages', () => {
  it('step with empty sources is a schema error', () => {
    const g = valid();
    g.steps.s2.sources = [];
    expect(fail(g)[0]!.code).toBe('schema');
  });
  it('drops invalid sources but keeps the step if one is valid', () => {
    const g = valid();
    g.steps.s2.sources.push({ pageIndex: 40, regionFallback: false });
    const r = ok(g);
    expect(r.guide.steps.s2!.sources).toHaveLength(1);
    expect(r.issues.map((i) => i.code)).toContain('source_dropped');
  });
  it('fails when a part source page is out of range', () => {
    expect(fail(valid(), { pageCount: 1 }).map((e) => e.code)).toContain('invalid_page');
  });
  it('drops highlights on invalid pages', () => {
    const g = valid();
    g.steps.s2.highlights[0].source.pageIndex = 77;
    const r = ok(g);
    expect(r.guide.steps.s2!.highlights).toHaveLength(1);
    expect(r.issues.map((i) => i.code)).toContain('highlight_dropped');
  });
  it('drops unreadable pages outside the document', () => {
    const g = valid();
    g.unreadablePages = [{ pageIndex: 2 }, { pageIndex: 20 }];
    const r = ok(g);
    expect(r.guide.unreadablePages).toEqual([{ pageIndex: 2 }]);
  });
  it('removes a glossary source on an invalid page', () => {
    const g = valid();
    g.glossary[0].source.pageIndex = 50;
    expect(ok(g).guide.glossary[0]!.source).toBeUndefined();
  });
});

describe('regions', () => {
  const withRegion = (region: unknown) => {
    const g = valid();
    g.steps.s2.highlights[0].source.region = region;
    return g;
  };
  const hl = (g: ReturnType<typeof ok>) => g.guide.steps.s2!.highlights[0]!.source;

  it('clamps out-of-range regions', () => {
    const r = ok(withRegion({ x: -0.2, y: 0.5, w: 1.5, h: 0.2 }));
    expect(hl(r).region).toEqual({ x: 0, y: 0.5, w: 1, h: 0.2 });
    expect(hl(r).regionFallback).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('region_clamped');
  });
  it('keeps the right edge when only the origin overflows', () => {
    const r = ok(withRegion({ x: 0.8, y: 0.1, w: 0.5, h: 0.1 }));
    expect(hl(r).region).toMatchObject({ x: 0.8 });
    expect(hl(r).region!.w).toBeCloseTo(0.2);
  });
  it.each([
    ['zero width', { x: 0.1, y: 0.1, w: 0, h: 0.2 }],
    ['negative height', { x: 0.1, y: 0.1, w: 0.2, h: -0.2 }],
    ['NaN-like', { x: 'a', y: 0.1, w: 0.2, h: 0.2 }],
    ['fully off page', { x: 1.5, y: 0.1, w: 0.2, h: 0.2 }],
    ['tiny', { x: 0.1, y: 0.1, w: 0.001, h: 0.2 }],
  ])('drops degenerate region (%s) and sets regionFallback', (_n, region) => {
    const r = ok(withRegion(region));
    expect(hl(r).region).toBeUndefined();
    expect(hl(r).regionFallback).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain('region_dropped');
  });
  it('clamps part-source regions too', () => {
    const g = valid();
    g.parts[0].source.region = { x: 0.9, y: 0.9, w: 0.5, h: 0.5 };
    const r = ok(g);
    expect(r.guide.parts[0]!.source.region!.w).toBeCloseTo(0.1);
  });
});

describe('provenance rules', () => {
  it('relabels manual guidance without a quote as inferred (and keeps it if it has no numbers)', () => {
    const g = valid();
    g.steps.s2.why = { text: 'Keeps the panels aligned.', origin: 'manual' };
    const r = ok(g);
    expect(r.guide.steps.s2!.why).toEqual({ text: 'Keeps the panels aligned.', origin: 'inferred' });
    expect(r.issues.map((i) => i.code)).toContain('manual_without_quote');
  });
  it('manual guidance with a quote is untouched', () => {
    const r = ok(valid());
    expect(r.guide.steps.s2!.checkpoint).toMatchObject({ origin: 'manual', sourceQuote: expect.any(String) });
  });
  it('a warning without a quote becomes interpretedFromDiagram', () => {
    const g = valid();
    g.steps.s5.warnings[0] = { text: 'Be careful.', severity: 'caution', interpretedFromDiagram: false };
    const r = ok(g);
    expect(r.guide.steps.s5!.warnings[0]!.interpretedFromDiagram).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain('warning_without_quote');
  });
  it('a quoted warning keeps interpretedFromDiagram false', () => {
    expect(ok(valid()).guide.steps.s9!.warnings[0]!.interpretedFromDiagram).toBe(false);
  });
  it.each([
    'Tighten to 5 Nm.',
    'Leave it for 10 minutes first.',
    'Use about two screws.',
    'Roughly 3mm gap.',
    'Needs 12 volts',
  ])('strips inferred guidance containing quantities: %s', (text) => {
    const g = valid();
    g.steps.s2.commonMistake = { text, origin: 'inferred' };
    const r = ok(g);
    expect(r.guide.steps.s2!.commonMistake).toBeUndefined();
    expect(r.issues.map((i) => i.code)).toContain('inferred_quantity_stripped');
  });
  it('manual-claimed guidance without a quote is relabelled then stripped if it has numbers', () => {
    const g = valid();
    g.steps.s2.why = { text: 'Use 4 of them.', origin: 'manual' };
    const r = ok(g);
    expect(r.guide.steps.s2!.why).toBeUndefined();
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['manual_without_quote', 'inferred_quantity_stripped']));
  });
  it('manual guidance with a quote may contain numbers', () => {
    const g = valid();
    g.steps.s2.why = { text: 'Use 4 of them.', origin: 'manual', sourceQuote: 'Press 4 dowels G into the top edge of each side panel A.' };
    expect(ok(g).guide.steps.s2!.why).toBeDefined();
  });
  it('step with numbers and no quote is downgraded to low', () => {
    const g = valid();
    delete g.steps.s2.sourceQuote;
    const r = ok(g);
    expect(r.guide.steps.s2!.confidence).toBe('low');
    expect(r.issues.map((i) => i.code)).toContain('numbers_without_quote');
  });
  it('detects spelled-out quantities in a step without a quote', () => {
    const g = valid();
    g.steps.s1.instruction = 'Lay out the two long panels.';
    delete g.steps.s1.sourceQuote;
    expect(ok(g).guide.steps.s1!.confidence).toBe('low');
  });
  it('step without numbers needs no quote', () => {
    const g = valid();
    expect(g.steps.s6.sourceQuote).toBeUndefined();
    expect(ok(g).guide.steps.s6!.confidence).toBe('high');
  });
});

describe('containsQuantity', () => {
  it.each([
    ['4 screws', true],
    ['two screws', true],
    ['Two Screws', true],
    ['5mm', true],
    ['one at a time', false],
    ['half a turn', true],
    ['\u00bd turn', true],
    ['Phone', false],
    ['second panel', false],
    ['twofold', true],
    ['tighten firmly', false],
  ])('%s -> %s', (text, expected) => expect(containsQuantity(text)).toBe(expected));
});

describe('quote verification against page text', () => {
  it('removes a quote not found on the step pages, with consequences', () => {
    const g = valid();
    g.steps.s2.sourceQuote = 'This sentence is not in the manual.';
    g.steps.s2.checkpoint = { text: 'Firm.', origin: 'manual', sourceQuote: 'Invented quote' };
    g.steps.s9.warnings[0].sourceQuote = 'Invented warning quote';
    const r = ok(g);
    expect(r.guide.steps.s2!.sourceQuote).toBeUndefined();
    expect(r.guide.steps.s2!.confidence).toBe('low');
    expect(r.guide.steps.s2!.checkpoint!.origin).toBe('inferred');
    expect(r.guide.steps.s9!.warnings[0]!.interpretedFromDiagram).toBe(true);
    expect(r.issues.filter((i) => i.code === 'quote_not_found')).toHaveLength(3);
  });
  it('matches ignoring case and whitespace', () => {
    const g = valid();
    g.steps.s2.sourceQuote = '  PRESS 4   dowels G into the top edge\n of each side panel A. ';
    const r = ok(g);
    expect(r.guide.steps.s2!.sourceQuote).toBeDefined();
    expect(r.issues).toEqual([]);
  });
  it('a quote found only on a page that is not a source of the step is not accepted', () => {
    const g = valid();
    g.steps.s2.sourceQuote = 'WARNING: Attach the wall strap. An unsecured bookcase can tip over and cause serious injury.';
    expect(ok(g).issues.map((i) => i.code)).toContain('quote_not_found');
  });
  it('records a single info issue when page text is not supplied', () => {
    const r = ok(valid(), { pageCount: 6 });
    expect(r.issues.filter((i) => i.code === 'quotes_unverified')).toHaveLength(1);
    expect(r.guide.steps.s2!.sourceQuote).toBeDefined();
  });
});

describe('hardening', () => {
  it('whitespace-only quotes are not quotes', () => {
    const g = valid();
    g.steps.s2.sourceQuote = '   ';
    g.steps.s5.warnings[0].sourceQuote = ' ';
    const r = ok(g);
    expect(r.guide.steps.s2!.confidence).toBe('low');
    expect(r.guide.steps.s5!.warnings[0]!.interpretedFromDiagram).toBe(true);
    expect(r.issues.filter((i) => i.code === 'blank_quote_removed')).toHaveLength(2);
  });
  it('reports removing a quote from inferred guidance', () => {
    const g = valid();
    g.steps.s6.why = { text: 'Helps.', origin: 'inferred', sourceQuote: 'Fit the second side panel' };
    expect(ok(g).issues.map((i) => i.code)).toContain('inferred_quote_removed');
  });
  it('rejects empty phases, zero steps, and oversized text', () => {
    const a = valid();
    a.phases.push({ id: 'e', title: 'E', stepIds: [] });
    expect(fail(a)).not.toHaveLength(0);
    const b = valid();
    b.steps = {};
    b.phases = [{ id: 'p', title: 'P', stepIds: ['x'] }];
    expect(fail(b)).not.toHaveLength(0);
    const c = valid();
    c.steps.s2.instruction = 'a'.repeat(10000);
    expect(fail(c)).not.toHaveLength(0);
  });
  it('strips unicode and spelled quantities from inferred guidance', () => {
    for (const text of ['Use \u00bd the force.', 'A quarter turn.', 'Twenty of them.']) {
      const g = valid();
      g.steps.s6.why = { text, origin: 'inferred' };
      expect(ok(g).guide.steps.s6!.why, text).toBeUndefined();
    }
  });
});
