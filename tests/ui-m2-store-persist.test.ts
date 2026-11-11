import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/client/api';
import { GuideStore, type GuideProgress } from '@/lib/client/guide-store';
import type { ValidatedGuide } from '@/lib/guide/validate';

const guide = { title: 'g' } as unknown as ValidatedGuide;
const TIMERS = { debounceMs: 100, retryDelays: [1000, 2000] };

function setup(opts: { server?: GuideProgress; saves?: Array<'ok' | ApiError> } = {}) {
  const calls: GuideProgress[] = [];
  const keepalive: boolean[] = [];
  const queue = [...(opts.saves ?? [])];
  let loads = 0;
  const net = {
    async load() {
      loads += 1;
      return { documentId: 'd1', guide, pageCount: 6, progress: opts.server ?? { currentStepId: null, completedStepIds: [], checklist: {} } };
    },
    async save(_id: string, body: GuideProgress, o: { keepalive: boolean }) {
      calls.push(structuredClone(body));
      keepalive.push(o.keepalive);
      const next = queue.shift() ?? 'ok';
      if (next !== 'ok') throw next;
      return body;
    },
  };
  const store = new GuideStore('g1', net, TIMERS);
  return { store, calls, keepalive, loads: () => loads };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('GuideStore persistence', () => {
  it('loads once and exposes the guide, document and page count', async () => {
    const { store, loads } = setup();
    await store.load();
    await store.load();
    expect(loads()).toBe(1);
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', documentId: 'd1', pageCount: 6 });
  });

  it('reports not_found and error statuses', async () => {
    const notFound = new GuideStore('x', { load: () => Promise.reject(new ApiError('not_found', 'no', 404)), save: vi.fn() }, TIMERS);
    await notFound.load();
    expect(notFound.getSnapshot().status).toBe('not_found');
    const broken = new GuideStore('x', { load: () => Promise.reject(new ApiError('network', 'down')), save: vi.fn() }, TIMERS);
    await broken.load();
    expect(broken.getSnapshot().status).toBe('error');
  });

  it('applies writes optimistically and debounces several changes into one PUT', async () => {
    const { store, calls } = setup();
    await store.load();
    store.completeStep('s1');
    store.completeStep('s2');
    store.setChecklistItem('cam', 'have');
    expect(store.getSnapshot().progress.completedStepIds).toEqual(['s1', 's2']);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(99);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ currentStepId: null, completedStepIds: ['s1', 's2'], checklist: { cam: 'have' } });
    expect(store.getSnapshot().saveState).toBe('idle');
  });

  it('flush sends immediately (with keepalive on page hide)', async () => {
    const { store, calls, keepalive } = setup();
    await store.load();
    store.completeStep('s1');
    await store.flush(true);
    expect(calls).toHaveLength(1);
    expect(keepalive).toEqual([true]);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(1);
  });

  it('flushes when the last subscriber leaves', async () => {
    const { store, calls } = setup();
    await store.load();
    const off = store.subscribe(() => {});
    store.completeStep('s1');
    off();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
  });

  it('shows the error state on failure, keeps the optimistic data, retries and recovers', async () => {
    const { store, calls } = setup({ saves: [new ApiError('network', 'down')] });
    await store.load();
    store.completeStep('s1');
    await vi.advanceTimersByTimeAsync(101);
    expect(store.getSnapshot().saveState).toBe('error');
    expect(store.getSnapshot().progress.completedStepIds).toEqual(['s1']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(2);
    expect(store.getSnapshot().saveState).toBe('idle');
  });

  it('stops auto-retrying after the configured delays; retrySave tries again', async () => {
    const down = () => new ApiError('network', 'down');
    const { store, calls } = setup({ saves: [down(), down(), down()] });
    await store.load();
    store.completeStep('s1');
    await vi.advanceTimersByTimeAsync(101 + 1000 + 2000 + 5000);
    expect(calls).toHaveLength(3);
    expect(store.getSnapshot().saveState).toBe('error');
    await store.retrySave();
    expect(calls).toHaveLength(4);
    expect(store.getSnapshot().saveState).toBe('idle');
  });

  it('does not auto-retry a rejected body (4xx) but still allows a manual retry', async () => {
    const { store, calls } = setup({ saves: [new ApiError('invalid_request', 'bad', 400)] });
    await store.load();
    store.completeStep('s1');
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);
    expect(store.getSnapshot().saveState).toBe('error');
    await store.retrySave();
    expect(calls).toHaveLength(2);
  });

  it('a change made while a save is in flight is sent afterwards and never lost', async () => {
    let release!: () => void;
    const calls: GuideProgress[] = [];
    const net = {
      load: async () => ({ documentId: 'd', guide, pageCount: 1, progress: { currentStepId: null, completedStepIds: [], checklist: {} } }),
      save: (_: string, body: GuideProgress) => {
        calls.push(structuredClone(body));
        return calls.length === 1 ? new Promise<GuideProgress>((r) => (release = () => r(body))) : Promise.resolve(body);
      },
    };
    const store = new GuideStore('g', net, TIMERS);
    await store.load();
    store.completeStep('s1');
    await vi.advanceTimersByTimeAsync(101);
    store.completeStep('s2');
    await vi.advanceTimersByTimeAsync(101);
    expect(calls).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.completedStepIds).toEqual(['s1', 's2']);
    expect(store.getSnapshot().progress.completedStepIds).toEqual(['s1', 's2']);
  });

  it('merges newer server progress from the save response without dropping local steps', async () => {
    const net = {
      load: async () => ({ documentId: 'd', guide, pageCount: 1, progress: { currentStepId: null, completedStepIds: [], checklist: {} } }),
      save: async () => ({ currentStepId: 's8', completedStepIds: ['s7'], checklist: {} }),
    };
    const store = new GuideStore('g', net, TIMERS);
    await store.load();
    store.completeStep('s1');
    await store.flush();
    // Newer server progress is taken in, and the step just saved is not lost.
    expect(store.getSnapshot().progress.completedStepIds.sort()).toEqual(['s1', 's7']);
    expect(store.getSnapshot().progress.currentStepId).toBe('s8');
  });
});
