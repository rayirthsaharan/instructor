import { createElement as h } from 'react';
import { renderToStaticMarkup as html } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Disclosure } from '@/components/ui';
import { ActionBar, PlayerProgress } from '@/components/features/player/chrome';
import { StepRail } from '@/components/features/player/StepRail';
import { progressPhases, railGroups, stepPosition } from '@/components/features/player/model';
import { validateGuide } from '@/lib/guide/validate';

const res = validateGuide(JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'lumen-bookcase.guide.json'), 'utf8')), { pageCount: 6 });
if (!res.ok) throw new Error('fixture invalid');
const guide = res.guide;
const noop = () => {};

describe('StepRail', () => {
  const groups = railGroups(guide, ['s1'], { 'cam-lock': 'missing' });
  const markup = html(h(StepRail, { groups, currentStepId: 's4', onSelect: noop, scrollCurrentIntoView: false }));
  it('groups steps by phase with done counts', () => {
    expect(markup.match(/<h3/g)).toHaveLength(3);
    expect(markup).toContain('1/3');
    expect(markup).toContain('0/4');
  });
  it('marks exactly one current step and the flags have text alternatives', () => {
    expect(markup.match(/aria-current="step"/g)).toHaveLength(1);
    expect(markup).toContain("Can&#x27;t be undone");
    expect(markup).toContain('Double-check with the original');
    expect(markup).toContain('Needs a part you marked missing');
  });
  it('the compact strip keeps an accessible name per row', () => {
    const compact = html(h(StepRail, { groups, currentStepId: 's1', onSelect: noop, compact: true, scrollCurrentIntoView: false }));
    expect(compact).toContain('aria-label="Step 1: Check the parts, done"');
  });
});

describe('ActionBar', () => {
  const base = { canGoBack: true, irreversible: false, nextIrreversible: false, onBack: noop, onPrimary: noop, onSteps: noop, onAsk: noop };
  it('phone: icon buttons are named; tablet shows labels', () => {
    const phone = html(h(ActionBar, { ...base, layout: 'phone', primary: { kind: 'complete', label: 'Done - next step' } }));
    expect(phone).toContain('aria-label="Previous step"');
    expect(phone).toContain('aria-label="Steps"');
    expect(phone).toContain('aria-label="Ask"');
    const tablet = html(h(ActionBar, { ...base, layout: 'tablet', primary: { kind: 'complete', label: 'Done - next step' } }));
    expect(tablet).toContain('<span>Back</span>');
    expect(tablet).toContain('<span>Steps</span>');
  });
  it('desktop has no Steps button; the first step has no Back', () => {
    const m = html(h(ActionBar, { ...base, canGoBack: false, layout: 'desktop', primary: { kind: 'next', label: 'Next step' } }));
    expect(m).not.toContain('steps-button');
    expect(m).toMatch(/data-testid="back"[^>]*disabled|disabled[^>]*data-testid="back"/);
  });
  it('shows the irreversible notice only when the next step is irreversible', () => {
    const on = html(h(ActionBar, { ...base, nextIrreversible: true, layout: 'phone', primary: { kind: 'complete', label: 'Done - next step' } }));
    expect(on).toContain("Next step can&#x27;t be undone");
    const off = html(h(ActionBar, { ...base, layout: 'phone', primary: { kind: 'complete', label: 'Done - next step' } }));
    expect(off).not.toContain("can&#x27;t be undone");
  });
  it('the irreversible primary is outlined (secondary), never filled', () => {
    const m = html(h(ActionBar, { ...base, irreversible: true, layout: 'phone', primary: { kind: 'irreversible', label: 'I checked - done' } }));
    expect(m).toContain('I checked - done');
    expect(m).toContain('border-t-2 border-danger-fg');
    expect(m).not.toMatch(/data-testid="primary"[^>]*bg-accent /);
  });
});

describe('PlayerProgress', () => {
  it('exposes the step as the accessible value and one segment per phase', () => {
    const groups = railGroups(guide, ['s1', 's2', 's3'], {});
    const m = html(h(PlayerProgress, { groups, position: stepPosition(guide, 's4'), title: 'Press in the cam locks', irreversible: false }));
    expect(m).toContain('aria-valuetext="Step 4 of 10, Press in the cam locks"');
    expect(m.match(/data-testid="progress-segment"/g)).toHaveLength(progressPhases(groups).length);
    expect(m).toContain('bg-success-fg'); // the finished phase
  });
});

describe('Disclosure', () => {
  it('is collapsed by default with aria-expanded and hidden content', () => {
    const m = html(h(Disclosure, { label: 'Why this matters', children: 'Because.' }));
    expect(m).toContain('aria-expanded="false"');
    expect(m).toMatch(/hidden=""/);
  });
});
