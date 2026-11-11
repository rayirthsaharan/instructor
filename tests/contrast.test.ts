import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * WCAG 2.1 contrast over every token pair docs/DESIGN_SYSTEM.md states a ratio or minimum for.
 * Tokens are parsed from src/app/globals.css so the test checks what ships.
 * If a pair fails its stated minimum: DO NOT change the token - report it to the designer.
 */
const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

function block(selectorStart: string): string {
  const i = css.indexOf(selectorStart);
  if (i < 0) throw new Error(`block not found: ${selectorStart}`);
  const open = css.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j);
  }
  throw new Error('unbalanced');
}

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = vars(block('@theme static {'));
const dark = { ...light, ...vars(block(":root[data-theme='dark'] {")) };
const darkAuto = { ...light, ...vars(block(":root:not([data-theme='light']) {")) };

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

type Pair = { fg: string; bg: string; light?: number; dark?: number; note: string; discrepancy?: string };
const tok = (s: string) => `--color-${s}`;

// Minimums: the DS table value (rounded down by the designer) or the WCAG floor when only "needs 3.0" / category is given.
const pairs: Pair[] = [
  { fg: 'ink', bg: 'bg', light: 15.7, dark: 16.0, note: 'ink on bg' },
  { fg: 'ink', bg: 'surface', light: 17.4, dark: 14.6, note: 'ink on surface' },
  { fg: 'ink-muted', bg: 'bg', light: 6.3, dark: 8.5, note: 'ink-muted on bg' },
  { fg: 'ink-muted', bg: 'surface', light: 7.0, dark: 7.7, note: 'ink-muted on surface' },
  { fg: 'ink-muted', bg: 'surface-raised', dark: 6.9, note: 'ink-muted on raised (dark)' },
  { fg: 'ink-subtle', bg: 'bg', light: 3.3, dark: 5.0, note: 'ink-subtle on bg (non-text)' },
  { fg: 'ink-subtle', bg: 'surface', light: 3.6, dark: 4.6, note: 'ink-subtle on surface (non-text)' },
  { fg: 'accent', bg: 'bg', light: 5.9, dark: 8.6, note: 'accent on bg' },
  { fg: 'accent', bg: 'surface', light: 6.6, dark: 7.9, note: 'accent on surface' },
  { fg: 'on-accent', bg: 'accent', light: 6.6, dark: 7.9, note: 'on-accent on accent' },
  { fg: 'accent', bg: 'accent-soft', light: 5.5, dark: 6, note: 'accent on accent-soft' },
  // semantic: fg on surface / fg on soft
  { fg: 'warn-fg', bg: 'surface', light: 6.3, dark: 10.1, note: 'warn-fg on surface' },
  { fg: 'warn-fg', bg: 'warn-soft', light: 5.6, dark: 8.1, note: 'warn-fg on warn-soft' },
  { fg: 'danger-fg', bg: 'surface', light: 6.5, dark: 7.4, note: 'danger-fg on surface' },
  { fg: 'danger-fg', bg: 'danger-soft', light: 5.5, dark: 6.8, note: 'danger-fg on danger-soft' },
  { fg: 'success-fg', bg: 'surface', light: 6.5, dark: 9.5, note: 'success-fg on surface' },
  { fg: 'success-fg', bg: 'success-soft', light: 5.6, dark: 7, note: 'success-fg on success-soft' },
  { fg: 'unsure-fg', bg: 'surface', light: 7.3, dark: 8.4, note: 'unsure-fg on surface' },
  { fg: 'unsure-fg', bg: 'unsure-soft', light: 6.2, dark: 6, note: 'unsure-fg on unsure-soft',
    discrepancy: 'DS states 6.2 ("rounded down") but the true ratio is 6.1988 (rounded, not floored). Still passes WCAG AA 4.5. Token intentionally NOT changed; report to ui-ux-designer.' },
  // text on solid fills (DS 2.2: stated on-colour; WCAG 4.5 where no number is given)
  { fg: 'warn-on', bg: 'warn-solid', light: 8.6, dark: 4.5, note: 'warn-on on warn-solid' },
  { fg: 'danger-on', bg: 'danger-solid', light: 4.5, dark: 4.5, note: 'danger-on on danger-solid' },
  { fg: 'success-on', bg: 'success-solid', light: 4.5, dark: 4.5, note: 'success-on on success-solid' },
  { fg: 'unsure-on', bg: 'unsure-solid', light: 4.5, dark: 4.5, note: 'unsure-on on unsure-solid' },
  // Toast, light: bg text on ink fill (same pair as ink on bg)
  { fg: 'bg', bg: 'ink', light: 15.7, note: 'toast text (bg on ink), light' },
];

function themeCases(name: string, theme: Record<string, string>, key: 'light' | 'dark') {
  describe(`${name} theme`, () => {
    for (const p of pairs) {
      const min = p[key];
      if (min === undefined) continue;
      it(`${p.discrepancy ? '[DS DISCREPANCY - report to designer] ' : ''}${p.note}: >= ${min}`, () => {
        const fg = theme[tok(p.fg)];
        const bg = theme[tok(p.bg)];
        expect(fg, tok(p.fg)).toBeTruthy();
        expect(bg, tok(p.bg)).toBeTruthy();
        const r = ratio(fg!, bg!);
        expect(r, `${fg} on ${bg} = ${r.toFixed(4)} (DS minimum ${min}). ${p.discrepancy ?? ''}`).toBeGreaterThanOrEqual(min);
      });
    }
  });
}

describe('design-system contrast (WCAG 2.1)', () => {
  themeCases('light', light, 'light');
  themeCases('dark', dark, 'dark');

  it('diagram marking pairs (one value for both themes)', () => {
    const m = vars(css.slice(css.indexOf('--mark-stroke'), css.indexOf('--mark-cite-stroke') + 40).replace(/^/, 'x{') + '}');
    expect(ratio(m['--mark-stroke']!, '#ffffff')).toBeGreaterThanOrEqual(6.6);
    expect(ratio(m['--mark-callout-fg']!, m['--mark-callout-bg']!)).toBeGreaterThanOrEqual(6.6);
  });

  it('warn-solid light is a fill for ink content only (documented 2.0 vs white)', () => {
    expect(ratio(light['--color-warn-solid']!, '#ffffff')).toBeLessThan(3);
    expect(ratio(light['--color-warn-on']!, light['--color-warn-solid']!)).toBeGreaterThanOrEqual(8.6);
  });

  it('line is deliberately below 3:1 (never the only identifier of a control)', () => {
    expect(ratio(light['--color-line']!, light['--color-surface']!)).toBeLessThan(3);
    expect(ratio(dark['--color-line']!, dark['--color-surface']!)).toBeLessThan(3);
  });

  it('automatic dark block matches the explicit data-theme="dark" block', () => {
    for (const k of Object.keys(vars(block(":root[data-theme='dark'] {")))) expect(darkAuto[k], k).toBe(dark[k]);
  });

  it('every semantic stem defines fg, soft, solid and on in both themes', () => {
    for (const stem of ['warn', 'danger', 'success', 'unsure']) {
      for (const part of ['fg', 'soft', 'solid', 'on']) {
        expect(light[`--color-${stem}-${part}`], `light ${stem}-${part}`).toMatch(/^#/);
        expect(dark[`--color-${stem}-${part}`], `dark ${stem}-${part}`).toMatch(/^#/);
      }
    }
  });
});
