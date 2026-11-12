import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideStore, initialProgressState, pendingDelta, progressReducer, type GuideProgress, type ProgressDelta } from '@/lib/client/guide-store';
import type { ValidatedGuide } from '@/lib/guide/validate';

// H-027 regression: two tabs (two stores) on one guide share one server that applies deltas like PATCH /progress.
const guide = { title: 'g' } as unknown as ValidatedGuide;
const TIMERS = { debounceMs: 100, retryDelays: [1000] };
const EMPTY: GuideProgress = { currentStepId: null, completedStepIds: [], checklist: {} };

function applyDelta(p: GuideProgress, d: ProgressDelta): GuideProgress {
  const drop = new Set(d.uncomplete ?? []);
  const completedStepIds = p.completedStepIds.filter((s) => !drop.has(s));
  for (const s of d.complete ?? []) if (!completedStepIds.includes(s)) completedStepIds.push(s);
  return { currentStepId: d.currentStepId ?? p.currentStepId, completedStepIds, checklist: { ...p.checklist, ...d.checklist } };
}

function sharedServer(initial: GuideProgress = EMPTY) {
  let state = structuredClone(initial);
  const sent: ProgressDelta[] = [];
  const net = {
    load: async () => ({ documentId: 'd', guide, pageCount: 6, progress: structuredClone(state) }),
    save: async (_id: string, d: ProgressDelta) => {
      sent.push(structuredClone(d));
      state = applyDelta(state, d);
      return structuredClone(state);
    },
  };
  const tab = () => new GuideStore('g', net, TIMERS);
  return { tab, net, sent, state: () => state };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('two tabs on one guide (H-027)', () => {
  it('a stale tab that only navigates does not erase a step completed in the other tab', async () => {
    const srv = sharedServer({ ...EMPTY, currentStepId: 's1' });
    const a = srv.tab();
    const b = srv.tab();
    await b.load(); // B loads first and keeps its old copy
    await a.load();
    a.completeStep('s1');
    a.setCurrentStep('s2');
    await a.flush();
    b.setCurrentStep('s2'); // ArrowRight in B
    await b.flush();
    expect(srv.sent.at(-1)).toEqual({ currentStepId: 's2' }); // B never sends its completed set
    expect(srv.state().completedStepIds).toEqual(['s1']);
    expect(b.getSnapshot().progress.completedStepIds).toEqual(['s1']); // B adopted the merged response
  });

  it('interleaved operations from two tabs commute: either order gives the same server state', async () => {
    const run = async (order: 'ab' | 'ba') => {
      const srv = sharedServer({ currentStepId: 's1', completedStepIds: ['s1'], checklist: { cam: 'have' } });
      const a = srv.tab();
      const b = srv.tab();
      await a.load();
      await b.load();
      a.completeStep('s2');
      a.setChecklistItem('screw', 'missing');
      b.completeStep('s3');
      b.uncompleteStep('s1');
      b.setChecklistItem('cam', 'unchecked');
      const [first, second] = order === 'ab' ? [a, b] : [b, a];
      await first.flush();
      await second.flush();
      const s = srv.state();
      return { done: [...s.completedStepIds].sort(), checklist: s.checklist };
    };
    const ab = await run('ab');
    expect(ab).toEqual(await run('ba'));
    expect(ab).toEqual({ done: ['s2', 's3'], checklist: { cam: 'unchecked', screw: 'missing' } });
  });

  it('an explicit un-complete in one tab wins over a stale completed set in another', async () => {
    const srv = sharedServer({ currentStepId: 's2', completedStepIds: ['s1'], checklist: {} });
    const a = srv.tab();
    const b = srv.tab();
    await a.load();
    await b.load(); // B believes s1 is completed
    a.uncompleteStep('s1');
    await a.flush();
    b.completeStep('s2');
    b.setCurrentStep('s3');
    await b.flush();
    expect(srv.state().completedStepIds).toEqual(['s2']);
    expect(b.getSnapshot().progress.completedStepIds).toEqual(['s2']);
  });

  it('checklist merges per item: each tab only overwrites the items it changed', async () => {
    const srv = sharedServer({ ...EMPTY, checklist: { cam: 'have', dowel: 'have', screw: 'unchecked' } });
    const a = srv.tab();
    const b = srv.tab();
    await a.load();
    await b.load();
    a.setChecklistItem('cam', 'missing');
    await a.flush();
    b.setChecklistItem('screw', 'have');
    await b.flush();
    expect(srv.state().checklist).toEqual({ cam: 'missing', dowel: 'have', screw: 'have' });
    expect(srv.sent).toEqual([{ checklist: { cam: 'missing' } }, { checklist: { screw: 'have' } }]);
  });

  it('refresh (focus / visible) picks up the other tab and keeps pending local operations', async () => {
    const srv = sharedServer();
    const a = srv.tab();
    const b = srv.tab();
    await a.load();
    await b.load();
    a.completeStep('s1');
    await a.flush();
    b.setChecklistItem('cam', 'have'); // pending, not yet saved
    await b.refresh();
    expect(b.getSnapshot().progress).toMatchObject({ completedStepIds: ['s1'], checklist: { cam: 'have' } });
    await vi.advanceTimersByTimeAsync(101);
    expect(srv.state()).toMatchObject({ completedStepIds: ['s1'], checklist: { cam: 'have' } });
  });

  it('a refresh that overlaps a save is discarded (it may predate the save)', async () => {
    let state: GuideProgress = EMPTY;
    let releaseLoad!: () => void;
    const net = {
      load: vi.fn(async () => ({ documentId: 'd', guide, pageCount: 1, progress: structuredClone(state) })),
      save: async (_: string, d: ProgressDelta) => (state = applyDelta(state, d)),
    };
    const store = new GuideStore('g', net, TIMERS);
    await store.load();
    const stale = structuredClone(state);
    net.load.mockImplementationOnce(() => new Promise((r) => (releaseLoad = () => r({ documentId: 'd', guide, pageCount: 1, progress: stale }))));
    const refreshing = store.refresh();
    store.completeStep('s1');
    await store.flush();
    expect(store.getSnapshot().progress.completedStepIds).toEqual(['s1']);
    releaseLoad();
    await refreshing;
    expect(store.getSnapshot().progress.completedStepIds).toEqual(['s1']);
  });
});

describe('pending delta bookkeeping', () => {
  it('sends only operations, and complete/uncomplete of one step cancel into the latest intent', () => {
    let s = initialProgressState({ currentStepId: 's1', completedStepIds: ['s1'], checklist: {} });
    s = progressReducer(s, { type: 'complete', stepId: 's2' });
    s = progressReducer(s, { type: 'uncomplete', stepId: 's2' });
    s = progressReducer(s, { type: 'uncomplete', stepId: 's1' });
    s = progressReducer(s, { type: 'complete', stepId: 's1' });
    expect(pendingDelta(s)).toEqual({ complete: ['s1'], uncomplete: ['s2'] });
  });

  it('a save confirmed after further edits clears what it carried and keeps the rest pending', () => {
    let s = progressReducer(initialProgressState(), { type: 'complete', stepId: 's1' });
    s = progressReducer(s, { type: 'checklist', id: 'cam', state: 'have' });
    const sent = pendingDelta(s);
    const rev = s.rev;
    s = progressReducer(s, { type: 'checklist', id: 'cam', state: 'missing' }); // changed again in flight
    s = progressReducer(s, { type: 'saved', rev, sent, server: { currentStepId: null, completedStepIds: ['s1'], checklist: { cam: 'have' } } });
    expect(s.dirty).toBe(true);
    expect(pendingDelta(s)).toEqual({ checklist: { cam: 'missing' } });
    expect(s.progress.checklist).toEqual({ cam: 'missing' });
  });

  it('when a save carried everything still pending, the server copy is adopted (another tab may have un-completed)', () => {
    let s = initialProgressState({ currentStepId: null, completedStepIds: ['s1'], checklist: {} });
    s = progressReducer(s, { type: 'setCurrent', stepId: 's2' });
    const sent = pendingDelta(s);
    s = progressReducer(s, { type: 'saved', rev: s.rev, sent, server: { currentStepId: 's2', completedStepIds: [], checklist: {} } });
    expect(s.dirty).toBe(false);
    expect(s.progress.completedStepIds).toEqual([]);
  });
});
