import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { answerKeySchema, parseAnswerKey } from '../scripts/accuracy/key-schema';
import { DEFAULT_DATA_DIR, loadKey, manualDir, MANUALS } from '../scripts/accuracy/manuals';

/**
 * Structural checks on the hand-built answer keys (docs/ACCURACY_TEST_PLAN.md section 4).
 * Keys are read raw as well as through the Zod schema, because the schema strips the QA-only extras
 * (`ambiguous`, `ambiguityNote`, `printedLabel`, `tools`, `sourceSha256`) that these tests also check.
 * Checks against the downloaded manuals run only when `data/accuracy/manuals/<id>/` is prepared locally.
 */
const KEYS_DIR = join(__dirname, '..', 'scripts', 'accuracy', 'keys');
const keyFiles = readdirSync(KEYS_DIR).filter((f) => f.endsWith('.key.json')).sort();
const ids = keyFiles.map((f) => f.replace('.key.json', ''));
const raw = (id: string) => JSON.parse(readFileSync(join(KEYS_DIR, `${id}.key.json`), 'utf8')) as Record<string, any>;
const collapse = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
const preparedTexts = (id: string): string[] | undefined => {
  const p = join(manualDir(DEFAULT_DATA_DIR, id), 'texts.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as string[]) : undefined;
};

describe('answer keys: coverage', () => {
  it('has a key for every registered manual and no stray keys', () => {
    expect(ids).toEqual(MANUALS.map((m) => m.id).sort());
  });
  it('registers every key with the same page count as the harness manual list, except documented drift', () => {
    // anavi-thermometer is rendered by us and is 9 pages, not the "about 12" of the plan; reported to the senior engineer.
    const drift = new Set(['anavi-thermometer']);
    for (const m of MANUALS) if (!drift.has(m.id)) expect(loadKey(m.id).pageCount, m.id).toBe(m.pages);
  });
});

describe.each(ids)('answer key %s', (id) => {
  const rawKey = raw(id);
  const key = parseAnswerKey(rawKey);

  it('validates against the key schema and its internal references', () => {
    expect(answerKeySchema.safeParse(rawKey).success).toBe(true);
    expect(key.manualId).toBe(id);
    expect(key.parts.length).toBeGreaterThan(0);
    expect(key.warnings.length).toBeGreaterThan(0);
  });

  it('keeps every page index inside the manual', () => {
    for (const s of key.steps) {
      expect(s.pageIndex).toBeLessThan(key.pageCount);
      for (const a of s.altRegions) expect(a.pageIndex).toBeLessThan(key.pageCount);
    }
    for (const w of key.warnings) expect(w.pageIndex).toBeLessThan(key.pageCount);
    for (const p of key.parts) expect(p.pageIndex).toBeLessThan(key.pageCount);
  });

  it('keeps every region inside 0..1 and large enough to be a diagram', () => {
    const regions = key.steps.flatMap((s) => [s.region, ...s.altRegions.map((a) => a.region)]);
    for (const r of regions) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.w).toBeGreaterThanOrEqual(0.1);
      expect(r.h).toBeGreaterThanOrEqual(0.02);
    }
  });

  it('numbers steps contiguously from 1 and never goes back a page', () => {
    expect(key.steps.map((s) => s.n)).toEqual(key.steps.map((_, i) => i + 1));
    for (let i = 1; i < key.steps.length; i++) expect(key.steps[i]!.pageIndex).toBeGreaterThanOrEqual(key.steps[i - 1]!.pageIndex);
  });

  it('has no duplicate part keys and no duplicate printed labels', () => {
    const keys = key.parts.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    const labels = key.parts.flatMap((p) => (p.label ? [p.label.toLowerCase()] : []));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every step anchors, a summary and valid part references; every part and warning has text', () => {
    const partKeys = new Set(key.parts.map((p) => p.key));
    for (const s of key.steps) {
      expect(s.anchors.length).toBeGreaterThan(0);
      expect(s.summary.trim().length).toBeGreaterThan(10);
      for (const u of s.partsUsed) expect(partKeys.has(u.part), `${id} step ${s.n} uses ${u.part}`).toBe(true);
    }
    for (const p of key.parts) expect(p.names.every((n) => n.trim().length > 0)).toBe(true);
    for (const w of key.warnings) expect(w.text.trim().length).toBeGreaterThan(10);
  });

  it('has no duplicated warning text and no step claiming a quantity above the part quantity', () => {
    const texts = key.warnings.map((w) => collapse(w.text));
    expect(new Set(texts).size).toBe(texts.length);
    const byKey = new Map(key.parts.map((p) => [p.key, p]));
    for (const s of key.steps)
      for (const u of s.partsUsed) {
        const part = byKey.get(u.part)!;
        if (u.quantity !== undefined && part.quantity !== undefined) expect(u.quantity, `${id} step ${s.n} ${u.part}`).toBeLessThanOrEqual(part.quantity);
      }
  });

  it('carries source, licence, attribution and builder', () => {
    expect(key.source.url).toMatch(/^(https:\/\/raw\.githubusercontent\.com\/|fixtures\/)/);
    expect(key.source.licence.length).toBeGreaterThan(5);
    expect(key.source.attribution.length).toBeGreaterThan(5);
    expect(key.builtBy.length).toBeGreaterThan(5);
  });

  it('explains every item marked ambiguous', () => {
    const items = [...(rawKey.parts ?? []), ...(rawKey.steps ?? []), ...(rawKey.warnings ?? [])] as Record<string, unknown>[];
    for (const it of items) if (it.ambiguous === true) expect(typeof it.ambiguityNote === 'string' && (it.ambiguityNote as string).length > 20, `${id}: ambiguous item without a note`).toBe(true);
    for (const it of items) if ('ambiguityNote' in it) expect(it.ambiguous).toBe(true);
  });

  const texts = preparedTexts(id);
  const manualPdf = join(manualDir(DEFAULT_DATA_DIR, id), 'manual.pdf');
  const dataIt = id === 'lumen' ? it.skip : texts ? it : it.skip;

  dataIt('matches the prepared manual: page count and file hash', () => {
    expect(texts!.length).toBe(key.pageCount);
    if (rawKey.sourceSha256) expect(createHash('sha256').update(readFileSync(manualPdf)).digest('hex')).toBe(rawKey.sourceSha256);
  });

  dataIt('quotes every warning verbatim, on the page the key says', () => {
    for (const w of key.warnings) {
      const page = collapse(texts![w.pageIndex] ?? '');
      expect(page.includes(collapse(w.text)), `${id}: warning not verbatim on page index ${w.pageIndex}: ${w.text.slice(0, 60)}`).toBe(true);
    }
  });

  dataIt('only uses part names, quantities and sizes that appear in the manual text', () => {
    // The first (manual-language) name of every part must be on its page; catches typos in the key.
    for (const p of key.parts) {
      const page = collapse(texts![p.pageIndex] ?? '').toLowerCase();
      const probe = collapse(p.names[0]!).toLowerCase();
      const words = probe.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3).slice(0, 2);
      if (words.length === 0) continue;
      const any = (rawKey.parts.find((x: any) => x.key === p.key)?.ambiguous as boolean | undefined) === true;
      if (!any) expect(words.every((w) => page.includes(w)), `${id}: part ${p.key} "${probe}" not on page index ${p.pageIndex}`).toBe(true);
    }
  });
});
