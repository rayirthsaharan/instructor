import { describe, expect, it } from 'vitest';
import { initialProgressState, progressReducer, type ProgressAction, type ProgressState } from '@/lib/client/guide-store';
import { parsePlayerSearch, withPlayerSearch } from '@/components/features/player/url-state';

// Deterministic PRNG so failures reproduce.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const IDS = ['s1', 's2', 's3', 's4', 's5'];

describe('progress reducer invariants (randomised)', () => {
  it('never duplicates a completed step, and an unsaved completion survives any server copy', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      let st: ProgressState = initialProgressState();
      const userDone = new Set<string>(); // what the user has completed and not un-completed
      for (let i = 0; i < 40; i++) {
        const id = IDS[Math.floor(r() * IDS.length)]!;
        const roll = r();
        let a: ProgressAction;
        if (roll < 0.4) {
          a = { type: 'complete', stepId: id };
          userDone.add(id);
        } else if (roll < 0.55) {
          a = { type: 'uncomplete', stepId: id };
          userDone.delete(id);
        } else if (roll < 0.7) a = { type: 'setCurrent', stepId: id };
        else if (roll < 0.85) a = { type: 'server', server: { currentStepId: null, completedStepIds: IDS.filter(() => r() < 0.3), checklist: {} } };
        else a = { type: 'saved', rev: st.rev - (r() < 0.5 ? 0 : 1), server: { currentStepId: id, completedStepIds: IDS.filter(() => r() < 0.3), checklist: {} } };
        st = progressReducer(st, a);
        const done = st.progress.completedStepIds;
        expect(new Set(done).size, `seed ${seed} step ${i}: duplicate`).toBe(done.length);
        // the user's own completions are never lost while a local change is unsaved
        if (!st.dirty) {
          userDone.clear();
          for (const d of done) userDone.add(d); // with nothing unsaved the server copy is authoritative
        } else for (const d of userDone) expect(done, `seed ${seed} step ${i}: lost ${d}`).toContain(d);
      }
    }
  });

  it('an un-completed step is not resurrected by a stale server copy before the save lands', () => {
    let st = initialProgressState({ currentStepId: 's1', completedStepIds: ['s1', 's2'], checklist: {} });
    st = progressReducer(st, { type: 'uncomplete', stepId: 's2' });
    st = progressReducer(st, { type: 'server', server: { currentStepId: 's1', completedStepIds: ['s1', 's2'], checklist: {} } });
    expect(st.progress.completedStepIds).toEqual(['s1']);
  });

  it('checklist: a locally touched item wins over the server, untouched items follow the server', () => {
    let st = initialProgressState({ currentStepId: null, completedStepIds: [], checklist: { a: 'have', b: 'have' } });
    st = progressReducer(st, { type: 'checklist', id: 'a', state: 'missing' });
    st = progressReducer(st, { type: 'server', server: { currentStepId: null, completedStepIds: [], checklist: { a: 'have', b: 'unchecked', c: 'missing' } } });
    expect(st.progress.checklist).toEqual({ a: 'missing', b: 'unchecked', c: 'missing' });
  });

  it('prototype-polluting checklist ids are inert', () => {
    let st = initialProgressState();
    st = progressReducer(st, { type: 'checklist', id: '__proto__', state: 'missing' });
    st = progressReducer(st, { type: 'server', server: JSON.parse('{"currentStepId":null,"completedStepIds":[],"checklist":{"__proto__":"have","constructor":"missing"}}') });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(st.progress.checklist)).toBe(Object.prototype);
  });
});

describe('player URL parsing (fuzz)', () => {
  const junk = ['', 'nope', '__proto__', '0', '-1', '1.5', '1e3', '99999999999999999999', '%00', '<script>', 'x'.repeat(500), '１２', ' 3', '3 ', '0x10'];
  it('never throws, always yields a bounded, well-typed result', () => {
    for (const step of junk)
      for (const panel of [...junk, 'steps', 'ask', 'original'])
        for (const page of junk) {
          const q = new URLSearchParams({ step, panel, page }).toString();
          const u = parsePlayerSearch(q);
          expect(u.step === null || typeof u.step === 'string').toBe(true);
          expect([null, 'steps', 'ask', 'original']).toContain(u.panel);
          if (u.page !== null) {
            expect(u.panel).toBe('original');
            expect(Number.isInteger(u.page) && u.page >= 1 && u.page <= 999_999).toBe(true);
          }
          if (u.step !== null) expect(u.step.length).toBeLessThanOrEqual(100);
          withPlayerSearch(q, { step: 's1', panel: null, page: null });
        }
  });

  it('clearing the panel always clears the page, and a page is only written with panel=original', () => {
    expect(withPlayerSearch('?step=s1&panel=original&page=3', { panel: null, page: null })).toBe('?step=s1');
    expect(withPlayerSearch('?step=s1&panel=steps', { page: 4 })).toBe('?step=s1&panel=steps');
    expect(withPlayerSearch('?step=s1&panel=original&page=3', { page: 2.9 })).toBe('?step=s1&panel=original&page=2');
  });
});
