import { describe, expect, it } from 'vitest';
import { validateCitations, findIntroducedQuantities, validateGuide, type ValidatedGuide } from '@/lib/guide/validate';
import { guideSchema } from '@/lib/guide/schema';
import { orderedSteps } from '@/lib/guide/selectors';
import { MockProvider, loadFixtureGuide, simplifyStepChecked, AIProviderError, type AIProvider } from '@/lib/ai';
import fixture from '../fixtures/lumen-bookcase.guide.json';

const guide = loadFixtureGuide();

describe('ValidatedGuide brand', () => {
  it('is only obtainable from validateGuide; a schema-parsed Guide is rejected by the type system', () => {
    const parsed = guideSchema.parse(fixture);
    // @ts-expect-error a schema-parsed Guide is not a ValidatedGuide
    const nope: ValidatedGuide = parsed;
    void nope;
    // @ts-expect-error selectors demand proof of validation
    orderedSteps(parsed);
    const r = validateGuide(fixture, { pageCount: 6 });
    if (!r.ok) throw new Error('fixture invalid');
    const typed: ValidatedGuide = r.guide;
    expect(orderedSteps(typed).length).toBeGreaterThan(0);
  });

  it('loadFixtureGuide runs the validator (not just the schema) and equals its output', () => {
    const r = validateGuide(fixture, { pageCount: 6 });
    if (!r.ok) throw new Error('fixture invalid');
    expect(guide).toEqual(r.guide);
  });

  it('provider methods only accept a ValidatedGuide', () => {
    const p = new MockProvider();
    // @ts-expect-error unvalidated guide
    void p.simplifyStep({ guide: guideSchema.parse(fixture), stepId: 's1', level: 'simpler' }).catch(() => {});
    expect(true).toBe(true);
  });
});

describe('validateCitations', () => {
  const ok = { stepId: 's1', pageIndex: 0 };
  it('keeps resolvable citations unchanged', () => {
    const region = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const r = validateCitations([ok, { ...ok, pageIndex: 5, region }], guide, 6);
    expect(r.citations).toEqual([ok, { ...ok, pageIndex: 5, region }]);
    expect(r.issues).toEqual([]);
  });
  it('drops unknown and inherited step ids', () => {
    const r = validateCitations([{ stepId: 'nope', pageIndex: 0 }, { stepId: 'constructor', pageIndex: 0 }, { stepId: '__proto__', pageIndex: 0 }], guide, 6);
    expect(r.citations).toEqual([]);
    expect(r.issues.map((i) => i.code)).toEqual(['citation_unknown_step', 'citation_unknown_step', 'citation_unknown_step']);
  });
  it.each([-1, 6, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('drops page %s out of range for 6 pages', (pageIndex) => {
    const r = validateCitations([{ stepId: 's1', pageIndex }], guide, 6);
    expect(r.citations).toEqual([]);
    expect(r.issues[0]?.code).toBe('citation_invalid_page');
  });
  it('clamps an overflowing region and reports it', () => {
    const r = validateCitations([{ ...ok, region: { x: 0.8, y: -0.2, w: 0.5, h: 0.6 } }], guide, 6);
    expect(r.citations[0]?.region).toEqual({ x: 0.8, y: 0, w: 0.2, h: 0.4 });
    expect(r.issues.map((i) => i.code)).toEqual(['citation_region_clamped']);
  });
  it('keeps the page but drops a degenerate or invalid region', () => {
    const r = validateCitations([{ ...ok, region: { x: 2, y: 2, w: 1, h: 1 } }, { ...ok, region: { x: 0, y: 0, w: Number.NaN, h: 1 } }], guide, 6);
    expect(r.citations).toEqual([ok, ok]);
    expect(r.issues.map((i) => i.code)).toEqual(['citation_region_dropped', 'citation_region_dropped']);
  });
  it('survives junk entries from a model', () => {
    const junk = [null, 7, { stepId: 3, pageIndex: 0 }] as unknown as { stepId: string; pageIndex: number }[];
    expect(validateCitations(junk, guide, 6).citations).toEqual([]);
  });
  it('does not mutate its input', () => {
    const input = [{ ...ok, region: { x: 0.8, y: 0, w: 0.5, h: 0.5 } }];
    const copy = structuredClone(input);
    validateCitations(input, guide, 6);
    expect(input).toEqual(copy);
  });
});

describe('findIntroducedQuantities', () => {
  it('is empty when the rewrite adds no numbers, or only drops them', () => {
    expect(findIntroducedQuantities('Insert 8 screws.', 'Put the screws in.')).toEqual([]);
    expect(findIntroducedQuantities('Insert 8 screws.', 'Insert 8 screws.')).toEqual([]);
  });
  it('flags digits and spelled-out numbers that are not in the original', () => {
    expect(findIntroducedQuantities('Insert the screws.', 'Insert 8 screws.')).toEqual(['8']);
    expect(findIntroducedQuantities('Insert 8 screws.', 'Insert 10 screws.')).toEqual(['10']);
    expect(findIntroducedQuantities('Insert the screws.', 'Insert about half of them, then two more.')).toEqual(['half', '2']);
  });
  it('treats a number word and its digit as the same quantity', () => {
    expect(findIntroducedQuantities('Insert eight screws.', 'Insert 8 screws.')).toEqual([]);
    expect(findIntroducedQuantities('Insert 2 screws.', 'Insert two screws.')).toEqual([]);
  });
  it('handles decimals and thousands separators', () => {
    expect(findIntroducedQuantities('Tighten to 1,500 mm.', 'Tighten to 1500 mm.')).toEqual([]);
    expect(findIntroducedQuantities('Tighten to 1.5 mm.', 'Tighten to 1.6 mm.')).toEqual(['1.6']);
  });
});

describe('simplifyStepChecked', () => {
  const stepWithNumber = orderedSteps(guide).find((s) => /\d/.test(s.instruction))!;
  const providerReturning = (text: string): AIProvider => {
    const real = new MockProvider();
    return Object.assign(Object.create(real) as AIProvider, { simplifyStep: async () => ({ text }) });
  };
  const input = { guide, stepId: stepWithNumber.id, level: 'simpler' as const };

  it('passes through a faithful simplification', async () => {
    const r = await simplifyStepChecked(new MockProvider(), input);
    expect(r.fellBack).toBe(false);
    expect(r.text.length).toBeGreaterThan(0);
  });
  it('falls back to the original instruction and reports what was introduced', async () => {
    const r = await simplifyStepChecked(providerReturning('Use 99 screws.'), input);
    expect(r).toEqual({ text: stepWithNumber.instruction, fellBack: true, introduced: ['99'] });
  });
  it('falls back on an empty rewrite', async () => {
    const r = await simplifyStepChecked(providerReturning('   '), input);
    expect(r.fellBack).toBe(true);
    expect(r.text).toBe(stepWithNumber.instruction);
  });
  it('propagates provider errors', async () => {
    await expect(simplifyStepChecked(new MockProvider(), { ...input, stepId: 'zzz' })).rejects.toBeInstanceOf(AIProviderError);
  });
});
