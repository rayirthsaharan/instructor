import { createElement as h } from 'react';
import { renderToStaticMarkup as html } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PartChip, ProgressRing, QuoteOrLine, quoteEqualsText } from '@/components/ui';
import { ActionBar } from '@/components/features/player/chrome';
import { primaryShortForm } from '@/components/features/player/model';
import { StepContent } from '@/components/features/player/StepContent';
import { stepPosition } from '@/components/features/player/model';
import { visualPages, visualTag } from '@/components/features/source-visual/pages';
import { validateGuide } from '@/lib/guide/validate';

const res = validateGuide(JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'lumen-bookcase.guide.json'), 'utf8')), { pageCount: 6 });
if (!res.ok) throw new Error('fixture invalid');
const guide = res.guide;
const noop = () => {};

describe('never the same words twice', () => {
  it('compares after trim and whitespace collapse, nothing fuzzier', () => {
    expect(quoteEqualsText('Push the  dowels in.', '  Push the dowels\nin. ')).toBe(true);
    expect(quoteEqualsText('Push the dowels in.', 'Push the dowels in')).toBe(false);
    expect(quoteEqualsText('Push the dowels in.', '')).toBe(false);
    expect(quoteEqualsText('Push the dowels in.', null)).toBe(false);
  });
  it('same words: one muted source line with the page tag, no blockquote', () => {
    const m = html(h(QuoteOrLine, { text: 'Tighten.', quote: ' Tighten. ', page: 3, onOpenPage: noop }));
    expect(m).toContain('From your manual');
    expect(m).toContain('p. 3');
    expect(m).not.toContain('<blockquote');
  });
  it('different words: the full Source quote; no quote: nothing', () => {
    const m = html(h(QuoteOrLine, { text: 'Tighten.', quote: 'Tighten firmly.', page: 3 }));
    expect(m).toContain('<blockquote');
    expect(m).toContain('Tighten firmly.');
    expect(html(h(QuoteOrLine, { text: 'Tighten.', quote: undefined, page: 3 }))).toBe('');
  });
  it('a step whose quote equals its instruction shows the instruction once', () => {
    const base = guide.steps.s2!;
    const step = { ...base, sourceQuote: base.instruction, highlights: [] };
    const m = html(
      h(StepContent, {
        guideId: 'g',
        guide,
        documentId: 'd',
        step,
        position: stepPosition(guide, 's2'),
        isDone: false,
        review: false,
        missing: [],
        selectedPartId: null,
        onSelectPart: noop,
        onOpenOriginal: noop,
        onFoundPart: noop,
      }),
    );
    expect(m.split(base.instruction).length - 1).toBe(1);
    expect(m).toContain('data-testid="source-line"');
  });
});

describe('part chips and callouts', () => {
  it('a chip shows the callout number, no thumbnail', () => {
    const m = html(h(PartChip, { name: 'Dowel', manualLabel: 'A', calloutNumber: 2 }));
    expect(m).toContain('data-testid="chip-marker"');
    expect(m).toContain('>2<');
    expect(m).not.toContain('<img');
  });
  it('no marker when nothing marks the part', () => {
    expect(html(h(PartChip, { name: 'Dowel' }))).not.toContain('chip-marker');
  });
  it('callout discs always show the 1-based index, never the label', () => {
    const marks = visualPages(guide.steps.s2!, guide.parts).flatMap((p) => p.marks).filter((m) => m.number !== null);
    expect(marks.map((m) => m.callout)).toEqual(marks.map((m) => String(m.number)));
    expect(marks.length).toBeGreaterThan(0);
  });
});

describe('status tag', () => {
  it('is hidden when Marks is off', () => {
    const page = visualPages({ ...guide.steps.s2!, sources: [{ pageIndex: 0, regionFallback: false }] }, guide.parts)[0]!;
    expect(visualTag(page, true, true)).toBe('lowConfidence');
    expect(visualTag(page, true, false)).toBeNull();
    expect(visualTag(page, false, false)).toBeNull();
  });
});

describe('Primary label never wraps', () => {
  it('short forms per USER_FLOWS 6.2', () => {
    expect(primaryShortForm('irreversible', 'phone')).toEqual({ text: 'I checked', arrow: false });
    expect(primaryShortForm('irreversible', 'landscape')).toEqual({ text: 'I checked', arrow: false });
    expect(primaryShortForm('irreversible', 'tablet')).toBeNull();
    expect(primaryShortForm('complete', 'landscape')).toEqual({ text: 'Done', arrow: true });
    expect(primaryShortForm('next', 'landscape')).toEqual({ text: 'Next', arrow: true });
    expect(primaryShortForm('complete-last', 'landscape')).toEqual({ text: 'Finish', arrow: false });
    expect(primaryShortForm('complete', 'phone')).toBeNull();
  });
  it('the short label keeps the full label as its accessible name', () => {
    const base = { canGoBack: true, irreversible: true, nextIrreversible: false, onBack: noop, onPrimary: noop, onSteps: noop, onAsk: noop };
    const m = html(h(ActionBar, { ...base, layout: 'phone', primary: { kind: 'irreversible', label: 'I checked - done' } }));
    expect(m).toContain('aria-label="I checked - done"');
    expect(m).toContain('whitespace-nowrap');
  });
});

describe('progress ring', () => {
  it('56px with the count inside', () => {
    const m = html(h(ProgressRing, { size: 56, text: '1/10', percent: 10 }));
    expect(m).toContain('width="56"');
    expect(m).toContain('1/10');
  });
});
