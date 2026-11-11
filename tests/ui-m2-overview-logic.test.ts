import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { completionModel } from '@/components/features/completion/completion';
import {
  againHref,
  blockedSteps,
  checklistCounts,
  cropStyle,
  difficultyLabel,
  isDemoGuide,
  missingSentence,
  numberList,
  readinessLine,
  startTarget,
  stepsNeeding,
} from '@/components/features/overview/logic';
import { validateGuide, type ValidatedGuide } from '@/lib/guide/validate';

const raw = JSON.parse(readFileSync('fixtures/lumen-bookcase.guide.json', 'utf8'));
const r = validateGuide(raw, { pageCount: 6 });
if (!r.ok) throw new Error('fixture invalid');
const guide: ValidatedGuide = r.guide;
const empty = { currentStepId: null, completedStepIds: [], checklist: {} };

describe('checklist logic (Lumen fixture)', () => {
  it('counts items and builds the readiness line', () => {
    const total = guide.tools.length + guide.parts.length;
    expect(checklistCounts(guide, {})).toMatchObject({ total, unchecked: total, have: 0 });
    expect(readinessLine(checklistCounts(guide, { shelf: 'have', hammer: 'have' }))).toBe(`2 of ${total} checked`);
    const all = Object.fromEntries([...guide.tools, ...guide.parts].map((i) => [i.id, 'have' as const]));
    expect(readinessLine(checklistCounts(guide, all))).toBe('Everything checked');
    expect(readinessLine(checklistCounts(guide, { 'cam-lock': 'missing' }))).toBe('1 part marked missing');
    expect(readinessLine(checklistCounts(guide, { 'cam-lock': 'missing', 'side-panel': 'missing' }))).toBe('2 parts marked missing');
    expect(readinessLine(checklistCounts(guide, { hammer: 'missing' }))).toBe('1 tool marked missing');
  });

  it('lists the steps a missing part blocks, from partsUsed', () => {
    expect(stepsNeeding(guide, 'part', 'shelf').map((s) => s.id)).toEqual(['s4', 's5']);
    expect(blockedSteps(guide, { shelf: 'missing' }).map((s) => s.n)).toEqual([4, 5]);
    expect(blockedSteps(guide, { shelf: 'have' })).toEqual([]);
    expect(blockedSteps(guide, {})).toEqual([]);
  });

  it('ignores prototype-key lookalikes in the checklist', () => {
    expect(blockedSteps(guide, JSON.parse('{"constructor":"missing"}'))).toEqual([]);
  });

  it('writes the "you can do steps before" sentence', () => {
    expect(missingSentence([{ n: 4, id: 's4' }], 1)).toBe('You can do steps 1-3 before you need it.');
    expect(missingSentence([{ n: 2, id: 's2' }], 1)).toBe('You can do step 1 before you need it.');
    expect(missingSentence([{ n: 1, id: 's1' }], 2)).toBe('You need them from the first step.');
    expect(missingSentence([], 1)).toBe('');
    expect(numberList([4, 9])).toBe('4 and 9');
    expect(numberList([4, 9, 12])).toBe('4, 9 and 12');
  });
});

describe('start target', () => {
  const first = 's1';
  it('Start on a fresh guide, at the first step', () => {
    expect(startTarget('g1', guide, empty)).toMatchObject({ mode: 'start', label: 'Start', href: `/g/g1/play?step=${first}` });
  });
  it('Continue at the saved step', () => {
    const t = startTarget('g1', guide, { currentStepId: 's4', completedStepIds: ['s1', 's2', 's3'], checklist: {} });
    expect(t).toMatchObject({ mode: 'continue', label: 'Continue at step 4', href: '/g/g1/play?step=s4' });
  });
  it('falls back to the first not-done step when the saved step no longer exists', () => {
    const t = startTarget('g1', guide, { currentStepId: 'gone', completedStepIds: ['s1', 's2'], checklist: {} });
    expect(t).toMatchObject({ mode: 'continue', stepId: 's3' });
  });
  it('Review steps when everything is done', () => {
    const all = Object.keys(guide.steps);
    expect(startTarget('g1', guide, { currentStepId: 's10', completedStepIds: all, checklist: {} })).toMatchObject({ mode: 'review', label: 'Review steps' });
  });
});

describe('small helpers', () => {
  it('builds the Start-again link with 1-based pages', () => {
    expect(againHref([6, 7, 11, 7])).toBe('/new?again=7,8,12');
    expect(againHref([])).toBe('/new');
  });
  it('labels difficulty and detects the demo guide', () => {
    expect([1, 2, 3].map((d) => difficultyLabel(d as 1 | 2 | 3))).toEqual(['Easy', 'Moderate', 'Demanding']);
    expect(isDemoGuide(guide)).toBe(false);
    expect(isDemoGuide({ ...guide, category: 'demo' } as ValidatedGuide)).toBe(true);
  });
  it('crops a region into a square box without distorting the page', () => {
    const s = cropStyle({ x: 0.04, y: 0.2, w: 0.3, h: 0.22 }, 1.414, 48);
    expect(s.height / s.width).toBeCloseTo(1.414);
    // the region fits inside the box and is centred on its limiting axis
    expect(0.3 * s.width).toBeLessThanOrEqual(48 + 1e-6);
    expect(0.22 * s.height).toBeLessThanOrEqual(48 + 1e-6);
    expect(s.left + 0.04 * s.width).toBeGreaterThanOrEqual(-1e-6);
  });
});

describe('completion model', () => {
  it('lists skipped steps in manual order and parts still marked missing with their steps', () => {
    const done = Object.keys(guide.steps).filter((id) => id !== 's3' && id !== 's8');
    const m = completionModel(guide, done, { shelf: 'missing', hammer: 'have' });
    expect(m.skipped.map((s) => s.id)).toEqual(['s3', 's8']);
    expect(m.doneCount).toBe(m.total - 2);
    expect(m.missing).toEqual([{ id: 'shelf', name: 'Shelf', kind: 'part', steps: [4, 5] }]);
  });
  it('reports nothing skipped when all steps are done', () => {
    expect(completionModel(guide, Object.keys(guide.steps), {}).skipped).toEqual([]);
  });
});
