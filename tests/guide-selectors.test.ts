import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateGuide } from '@/lib/guide/validate';
import { orderedSteps, partsForStep, phaseForStep, progressPercentage, stepsBlockedByMissingParts, toolsForStep } from '@/lib/guide/selectors';

const r = validateGuide(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/lumen-bookcase.guide.json'), 'utf8')), { pageCount: 6 });
if (!r.ok) throw new Error('fixture invalid');
const guide = r.guide;

describe('selectors', () => {
  it('orders steps by phases, ignoring map order', () => {
    expect(orderedSteps(guide).map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10']);
    const shuffled = { ...guide, steps: Object.fromEntries(Object.entries(guide.steps).reverse()) };
    expect(orderedSteps(shuffled).map((s) => s.id)[0]).toBe('s1');
  });
  it('skips unknown ids in phases', () => {
    const g = { ...guide, phases: [{ id: 'x', title: 'x', stepIds: ['nope', 's2'] }] };
    expect(orderedSteps(g).map((s) => s.id)).toEqual(['s2']);
  });
  it('finds the phase of a step', () => {
    expect(phaseForStep(guide, 's5')?.id).toBe('frame');
    expect(phaseForStep(guide, 'zzz')).toBeUndefined();
  });
  it('resolves parts and tools for a step', () => {
    const parts = partsForStep(guide, 's2');
    expect(parts.map((p) => [p.part.id, p.quantity])).toEqual([['dowel', 8], ['side-panel', 2]]);
    expect(partsForStep(guide, 'zzz')).toEqual([]);
    expect(toolsForStep(guide, 's7').map((t) => t.id)).toEqual(['hammer']);
    expect(toolsForStep(guide, 'zzz')).toEqual([]);
  });
  it('lists steps blocked by missing parts in order', () => {
    expect(stepsBlockedByMissingParts(guide, ['side-panel']).map((s) => s.id)).toEqual(['s2', 's3', 's5', 's6']);
    expect(stepsBlockedByMissingParts(guide, new Set(['nail'])).map((s) => s.id)).toEqual(['s7']);
    expect(stepsBlockedByMissingParts(guide, [])).toEqual([]);
    expect(stepsBlockedByMissingParts(guide, ['unknown'])).toEqual([]);
  });
  it('computes progress percentage', () => {
    expect(progressPercentage(guide, [])).toBe(0);
    expect(progressPercentage(guide, ['s1', 's2', 's3'])).toBe(30);
    expect(progressPercentage(guide, ['s1', 's1', 'bogus'])).toBe(10);
    expect(progressPercentage(guide, Object.keys(guide.steps))).toBe(100);
    expect(progressPercentage({ ...guide, steps: {} }, ['s1'])).toBe(0);
  });
});
