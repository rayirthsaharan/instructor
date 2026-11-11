import { describe, expect, it } from 'vitest';
import { segmentFills } from '@/components/ui/Progress';
import { warningSourceCase, normaliseQuote } from '@/components/ui/Banner';
import { citationLabel } from '@/components/ui/CitationChip';
import { toastDuration } from '@/components/ui/Toast';

describe('segmentFills', () => {
  const phases = [{ steps: 6 }, { steps: 10 }, { steps: 8 }];
  it('fills phases in order and caps at 1', () => {
    expect(segmentFills(phases, 0)).toEqual([0, 0, 0]);
    expect(segmentFills(phases, 6)).toEqual([1, 0, 0]);
    expect(segmentFills(phases, 11)).toEqual([1, 0.5, 0]);
    expect(segmentFills(phases, 99)).toEqual([1, 1, 1]);
  });
  it('ignores negative counts and empty phases', () => {
    expect(segmentFills(phases, -3)).toEqual([0, 0, 0]);
    expect(segmentFills([{ steps: 0 }, { steps: 2 }], 1)).toEqual([0, 0.5]);
  });
});

describe('warning source line cases (DS 7.12)', () => {
  it('same after trim + whitespace collapse', () => {
    expect(warningSourceCase('Do not  overtighten.', '  Do not overtighten.\n')).toBe('same');
  });
  it('different when wording differs (case-sensitive)', () => {
    expect(warningSourceCase('Do not overtighten.', 'DO NOT OVERTIGHTEN.')).toBe('different');
  });
  it('none when there is no quote', () => {
    expect(warningSourceCase('Hot surface.', undefined)).toBe('none');
    expect(warningSourceCase('Hot surface.', '   ')).toBe('none');
  });
  it('normaliseQuote', () => expect(normaliseQuote(' a \n b ')).toBe('a b'));
});

describe('citationLabel', () => {
  it('formats step and page', () => {
    expect(citationLabel(12, 7)).toEqual({ text: 'Step 7 · p. 12', aria: 'Open manual page 12, step 7' });
    expect(citationLabel(12)).toEqual({ text: 'p. 12', aria: 'Open manual page 12' });
  });
  it('rejects invalid citations', () => {
    expect(citationLabel(0)).toBeNull();
    expect(citationLabel(1.5)).toBeNull();
    expect(citationLabel(Number.NaN)).toBeNull();
  });
});

describe('toastDuration', () => {
  it('4s plain, 8s with action', () => {
    expect(toastDuration(false)).toBe(4000);
    expect(toastDuration(true)).toBe(8000);
  });
});
