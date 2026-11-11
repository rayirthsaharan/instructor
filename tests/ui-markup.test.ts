import { createElement as h } from 'react';
import { renderToStaticMarkup as html } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Banner,
  Button,
  ChecklistRow,
  CitationChip,
  Chip,
  IconButton,
  PartChip,
  ProgressRing,
  SegmentedProgress,
  SkeletonRegion,
  SourceQuote,
  WarningBanner,
} from '@/components/ui';

describe('Button', () => {
  it('defaults to type=button', () => {
    expect(html(h(Button, null, 'Go'))).toContain('type="button"');
  });
  it('loading sets aria-busy but is not disabled', () => {
    const m = html(h(Button, { loading: true, children: 'Go' }));
    expect(m).toContain('aria-busy="true"');
    expect(m).not.toMatch(/ disabled(=""| )/);
  });
  it('links a disabled helper line via aria-describedby', () => {
    const m = html(h(Button, { disabled: true, helper: 'Why not', children: 'Go' }));
    expect(m).toMatch(/aria-describedby="([^"]+)"[\s\S]*<p id="\1"/);
  });
});

describe('IconButton', () => {
  it('renders its aria-label and pressed state', () => {
    const m = html(h(IconButton, { icon: 'eye', 'aria-label': 'Marks', pressed: false }));
    expect(m).toContain('aria-label="Marks"');
    expect(m).toContain('aria-pressed="false"');
  });
});

describe('Chip / PartChip', () => {
  it('chip exposes selected via aria-pressed', () => {
    expect(html(h(Chip, { selected: true, children: 'A' }))).toContain('aria-pressed="true"');
  });
  it('part chip omits label, quantity and thumbnail when absent (never synthesised)', () => {
    const m = html(h(PartChip, { name: 'Back panel' }));
    expect(m).not.toContain('<img');
    expect(m).not.toContain('type-tag');
  });
  it('missing and tool states', () => {
    expect(html(h(PartChip, { name: 'X', missing: true }))).toContain('Missing');
    expect(html(h(PartChip, { name: 'Mallet', tool: true, included: false }))).toContain('Not in the box');
  });
});

describe('ChecklistRow', () => {
  it('checkbox semantics for each state', () => {
    expect(html(h(ChecklistRow, { name: 'A', status: 'have' }))).toContain('aria-checked="true"');
    expect(html(h(ChecklistRow, { name: 'A', status: 'unchecked' }))).toContain('aria-checked="false"');
    const missing = html(
      h(ChecklistRow, { name: 'A', status: 'missing', neededInSteps: [{ step: 4, href: '#4' }, { step: 9, href: '#9' }] }),
    );
    expect(missing).toContain('Marked missing');
    expect(missing).toContain('Needed in steps');
    expect(missing).toContain('href="#9"');
  });
});

describe('Progress', () => {
  it('progressbar has valuenow/max and valuetext', () => {
    const m = html(h(SegmentedProgress, { phases: [{ steps: 3 }], current: 2, total: 3, title: 'Frame' }));
    expect(m).toContain('aria-valuenow="2"');
    expect(m).toContain('aria-valuemax="3"');
    expect(m).toContain('aria-valuetext="Step 2 of 3, Frame"');
    expect(m).toContain('Step 2 of 3');
  });
  it('ring exposes percent', () => {
    expect(html(h(ProgressRing, { percent: 140 }))).toContain('aria-valuenow="100"');
  });
});

describe('Banner', () => {
  it('static banners are role=note, live ones role=alert', () => {
    expect(html(h(Banner, { kind: 'caution' }, 'x'))).toContain('role="note"');
    expect(html(h(Banner, { kind: 'error', live: true }, 'x'))).toContain('role="alert"');
  });
  it('fixed labels and text', () => {
    expect(html(h(Banner, { kind: 'caution' }, 'x'))).toContain('Caution');
    expect(html(h(Banner, { kind: 'warning' }, 'x'))).toContain('Warning');
    const irr = html(h(Banner, { kind: 'irreversible' }));
    expect(irr).toContain("Can&#x27;t be undone");
    expect(irr).toContain('Check the picture and the parts before you do this step.');
    expect(html(h(Banner, { kind: 'unsure' }))).toContain('Double-check');
  });
  it('warning banner source line: same / different / none', () => {
    const same = html(h(WarningBanner, { severity: 'caution', text: 'A  b', sourceQuote: 'A b', page: 12 }));
    expect(same).toContain('From your manual');
    expect(same).not.toContain('<blockquote');
    const diff = html(h(WarningBanner, { severity: 'caution', text: 'Be careful', sourceQuote: 'Vorsicht', page: 3, lang: 'de' }));
    expect(diff).toContain('<blockquote');
    expect(diff).toContain('lang="de"');
    expect(diff).toContain('Vorsicht');
    const none = html(h(WarningBanner, { severity: 'warning', text: 'Hot', page: 3 }));
    expect(none).toContain('Read from the picture');
    expect(none).not.toContain('<blockquote');
  });
  it('unrecognised severity renders as warning', () => {
    expect(html(h(WarningBanner, { severity: 'danger!', text: 'x', page: 1 }))).toContain('data-kind="warning"');
  });
});

describe('SourceQuote', () => {
  it('renders verbatim, no added quotation marks, page tag', () => {
    const q = '  Keep  OUT of reach\nof children  ';
    const m = html(h(SourceQuote, { quote: q, page: 12, lang: 'en' }));
    expect(m).toContain(q);
    expect(m).toContain('From your manual');
    expect(m).toContain('p. 12');
    expect(m).not.toMatch(/[“”"]Keep/);
  });
  it('renders nothing without a quote', () => {
    expect(html(h(SourceQuote, { quote: undefined, page: 1 }))).toBe('');
    expect(html(h(SourceQuote, { quote: '', page: 1 }))).toBe('');
  });
});

describe('CitationChip', () => {
  it('has the spec aria-label and text', () => {
    const m = html(h(CitationChip, { page: 12, stepNumber: 7 }));
    expect(m).toContain('aria-label="Open manual page 12, step 7"');
    expect(m).toContain('Step 7 · p. 12');
  });
  it('is not rendered when invalid', () => {
    expect(html(h(CitationChip, { page: 0 }))).toBe('');
  });
});

describe('Skeleton region', () => {
  it('hides content from AT with one Loading status', () => {
    const m = html(h(SkeletonRegion, null, h('div', null, 'x')));
    expect(m).toContain('role="status"');
    expect(m).toContain('Loading');
    expect(m).toContain('aria-hidden="true"');
  });
});
