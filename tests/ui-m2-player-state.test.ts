import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateGuide, type ValidatedGuide } from '@/lib/guide/validate';
import { parsePlayerSearch, withPlayerSearch } from '@/components/features/player/url-state';
import {
  missingPartSentence,
  missingPartsForStep,
  primaryAction,
  progressPhases,
  railGroups,
  readAloudScript,
  resolveStep,
  sortedWarnings,
  stepPosition,
} from '@/components/features/player/model';
import { marksForPage, pageForPart, visualPages, visualTag } from '@/components/features/source-visual/pages';

const raw = JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'lumen-bookcase.guide.json'), 'utf8'));
const res = validateGuide(raw, { pageCount: 6 });
if (!res.ok) throw new Error(JSON.stringify(res.errors));
const guide: ValidatedGuide = res.guide;

describe('player URL state', () => {
  it('parses step, panel and page', () => {
    expect(parsePlayerSearch('?step=s3&panel=original&page=4')).toEqual({ step: 's3', panel: 'original', page: 4 });
    expect(parsePlayerSearch('')).toEqual({ step: null, panel: null, page: null });
  });
  it('ignores unknown panels and bad pages; page needs panel=original', () => {
    expect(parsePlayerSearch('?panel=evil&page=3')).toEqual({ step: null, panel: null, page: null });
    expect(parsePlayerSearch('?panel=original&page=0').page).toBeNull();
    expect(parsePlayerSearch('?panel=original&page=-2').page).toBeNull();
    expect(parsePlayerSearch('?panel=original&page=1e3').page).toBeNull();
    expect(parsePlayerSearch('?panel=steps&page=3').page).toBeNull();
  });
  it('builds URLs, keeps unknown params, and clears page with the panel', () => {
    expect(withPlayerSearch('?step=s1', { panel: 'original', page: 2 })).toBe('?step=s1&panel=original&page=2');
    expect(withPlayerSearch('?step=s1&panel=original&page=2', { panel: null })).toBe('?step=s1');
    expect(withPlayerSearch('?step=s1&x=1', { step: 's2' })).toBe('?step=s2&x=1');
    expect(withPlayerSearch('?step=s1', { panel: 'steps', page: 5 })).toBe('?step=s1&panel=steps');
    expect(withPlayerSearch('?panel=original&page=2', { page: 3 })).toBe('?panel=original&page=3');
  });
});

describe('resolveStep (USER_FLOWS 6.6, 10.5)', () => {
  const none = { currentStepId: null, completedStepIds: [] as string[] };
  it('the URL wins', () => {
    expect(resolveStep(guide, 's4', { ...none, currentStepId: 's2' })).toMatchObject({ stepId: 's4', notice: null });
  });
  it('no step uses the saved step', () => {
    expect(resolveStep(guide, null, { currentStepId: 's7', completedStepIds: ['s1'] }).stepId).toBe('s7');
  });
  it('unknown ?step falls back to where the user left off, with a notice', () => {
    expect(resolveStep(guide, 'nope', { currentStepId: 's5', completedStepIds: [] })).toMatchObject({ stepId: 's5', notice: 'unknown-step' });
    expect(resolveStep(guide, 'constructor', none)).toMatchObject({ stepId: 's1', notice: 'unknown-step' });
  });
  it('a saved step that no longer exists opens at the first step not done', () => {
    expect(resolveStep(guide, null, { currentStepId: 'gone', completedStepIds: ['s1', 's2'] })).toMatchObject({ stepId: 's3', notice: 'updated-guide' });
  });
  it('a fresh guide opens at step 1; a finished guide opens at step 1 in review mode', () => {
    expect(resolveStep(guide, null, none)).toMatchObject({ stepId: 's1', review: false });
    const all = Object.keys(guide.steps);
    expect(resolveStep(guide, null, { currentStepId: 's10', completedStepIds: all })).toMatchObject({ stepId: 's1', review: true });
  });
});

describe('step position and actions', () => {
  it('numbers steps in manual order across phases', () => {
    const p = stepPosition(guide, 's5');
    expect(p).toMatchObject({ number: 5, total: 10 });
    expect(p.prev?.id).toBe('s4');
    expect(p.next?.id).toBe('s6');
    expect(p.phase?.id).toBe('frame');
    expect(stepPosition(guide, 's10').next).toBeNull();
  });
  it('primary label follows the spec', () => {
    const s = guide.steps.s2!;
    expect(primaryAction(s, false, false)).toEqual({ kind: 'complete', label: 'Done - next step' });
    expect(primaryAction(s, false, true).label).toBe('Done - finish');
    expect(primaryAction(s, true, false).label).toBe('Next step');
    expect(primaryAction(guide.steps.s7!, false, false)).toEqual({ kind: 'irreversible', label: 'I checked - done' });
  });
  it('warnings: severity warning first, manual order inside each group, none dropped', () => {
    const w = (text: string, severity: 'caution' | 'warning') => ({ text, severity, interpretedFromDiagram: false });
    const out = sortedWarnings([w('a', 'caution'), w('b', 'warning'), w('c', 'caution'), w('d', 'warning')]);
    expect(out.map((x) => x.text)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('read-aloud leads with irreversible and warnings, then title, instruction, checkpoint', () => {
    const s7 = readAloudScript(guide.steps.s7!);
    expect(s7[0]).toMatch(/can't be undone/);
    expect(s7[1]).toMatch(/^Warning: /);
    expect(s7).toContain(guide.steps.s7!.title);
    expect(s7.indexOf(guide.steps.s7!.instruction)).toBeGreaterThan(s7.indexOf(guide.steps.s7!.title));
    const s2 = readAloudScript(guide.steps.s2!);
    expect(s2.at(-1)).toMatch(/^You'll know it's right when /);
  });
});

describe('missing parts and the rail', () => {
  it('finds missing parts used by a step, with the step quantity', () => {
    const m = missingPartsForStep(guide, 's4', { 'cam-lock': 'missing', dowel: 'have' });
    expect(m).toHaveLength(1);
    expect(missingPartSentence(m[0]!)).toMatch(/^You marked Cam lock.* as missing\. This step needs \d+\.$/);
    expect(missingPartsForStep(guide, 's4', {})).toEqual([]);
  });
  it('groups steps by phase with done counts and flags', () => {
    const g = railGroups(guide, ['s1', 's2'], { 'cam-lock': 'missing' });
    expect(g.map((x) => x.phase.id)).toEqual(['prepare', 'frame', 'finish']);
    expect(g[0]).toMatchObject({ doneCount: 2 });
    expect(g[1]!.steps.find((s) => s.step.id === 's4')?.missingPart).toBe(true);
    expect(g[2]!.steps.find((s) => s.step.id === 's7')?.irreversible).toBe(true);
    expect(g[2]!.steps.find((s) => s.step.id === 's8')?.lowConfidence).toBe(true);
    expect(progressPhases(g)).toEqual([{ steps: 3 }, { steps: 3 }, { steps: 4 }]);
  });
});

describe('visual pages (USER_FLOWS 6.6, DS 7.10)', () => {
  it('a multi-source step pages through its sources in order', () => {
    const pages = visualPages(guide.steps.s1!, guide.parts);
    expect(pages.map((p) => p.pageIndex)).toEqual([0, 1]);
  });
  it('a highlight is drawn on its own page; a page referenced only by a highlight is appended', () => {
    const step = { ...guide.steps.s2!, highlights: [{ source: { pageIndex: 4, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, regionFallback: false }, partId: 'dowel', label: 'Dowels' }] };
    const pages = visualPages(step, guide.parts);
    expect(pages.map((p) => p.pageIndex)).toEqual([2, 4]);
    expect(pages[0]!.marks).toHaveLength(0);
    expect(pages[1]!.marks).toHaveLength(1);
    expect(pageForPart(pages, 'dowel')).toBe(1);
    expect(pageForPart(pages, 'nope')).toBe(-1);
  });
  it('highlights without a usable region are not drawn', () => {
    const pages = visualPages(guide.steps.s6!, guide.parts);
    expect(pages[0]!.marks).toHaveLength(0);
  });
  it('numbers callouts and describes marked areas', () => {
    const pages = visualPages(guide.steps.s2!, guide.parts);
    expect(pages[0]!.marks.map((m) => m.callout)).toEqual(['1', '2']);
    expect(pages[0]!.marks[0]!.description).toMatch(/^Marked area 1: Dowels/);
    expect(marksForPage(pages, 2)).toHaveLength(2);
    expect(marksForPage(pages, 3)).toHaveLength(0);
  });
  it('draws a source region that is approximate, dashed, with the Approximate area tag', () => {
    const step = {
      ...guide.steps.s2!,
      highlights: [],
      sources: [{ pageIndex: 2, region: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, regionFallback: true }],
    };
    const [page] = visualPages(step, guide.parts);
    expect(page!.marks).toHaveLength(1);
    expect(page!.marks[0]!.approximate).toBe(true);
    expect(visualTag(page!, false)).toBe('approximate');
    expect(visualTag(page!, true)).toBe('lowConfidence');
    expect(visualTag(page!, false, false)).toBeNull();
  });
  it('shows "Whole page shown" when there is no region', () => {
    const [page] = visualPages(guide.steps.s2!, guide.parts);
    expect(visualTag(page!, false)).toBe('wholePage');
  });
});
