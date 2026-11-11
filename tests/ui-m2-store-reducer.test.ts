import { describe, expect, it } from 'vitest';
import { initialProgressState, progressReducer, type ProgressAction, type ProgressState } from '@/lib/client/guide-store';

const run = (s: ProgressState, ...a: ProgressAction[]) => a.reduce(progressReducer, s);
const fresh = () => initialProgressState();

describe('progress reducer: local changes', () => {
  it('completes idempotently and keeps every other completed step', () => {
    const s = run(fresh(), { type: 'complete', stepId: 's1' }, { type: 'complete', stepId: 's2' }, { type: 'complete', stepId: 's1' });
    expect(s.progress.completedStepIds).toEqual(['s1', 's2']);
    expect(s.dirty).toBe(true);
  });
  it('returns the same state object when nothing changes', () => {
    const s = run(fresh(), { type: 'complete', stepId: 's1' });
    expect(progressReducer(s, { type: 'complete', stepId: 's1' })).toBe(s);
    expect(progressReducer(s, { type: 'uncomplete', stepId: 'zz' })).toBe(s);
    expect(progressReducer(fresh(), { type: 'checklist', id: 'a', state: 'unchecked' })).toEqual(fresh());
  });
  it('uncompletes and sets current and checklist', () => {
    const s = run(
      fresh(),
      { type: 'complete', stepId: 's1' },
      { type: 'uncomplete', stepId: 's1' },
      { type: 'setCurrent', stepId: 's3' },
      { type: 'checklist', id: 'cam', state: 'missing' },
    );
    expect(s.progress).toEqual({ currentStepId: 's3', completedStepIds: [], checklist: { cam: 'missing' } });
  });
});

describe('progress reducer: server copy', () => {
  const server = { currentStepId: 's5', completedStepIds: ['s1', 's2'], checklist: { a: 'have' as const } };
  it('server wins outright when there are no unsaved changes', () => {
    expect(run(fresh(), { type: 'server', server }).progress).toEqual(server);
  });
  it('never loses a locally completed step that the server copy lacks', () => {
    const s = run(fresh(), { type: 'complete', stepId: 's9' }, { type: 'server', server });
    expect(s.progress.completedStepIds.sort()).toEqual(['s1', 's2', 's9']);
  });
  it('does not resurrect a step the user un-completed before the save', () => {
    const s = run(initialProgressState(server), { type: 'uncomplete', stepId: 's2' }, { type: 'server', server });
    expect(s.progress.completedStepIds).toEqual(['s1']);
  });
  it('keeps locally changed checklist items and current step, takes the rest from the server', () => {
    const s = run(fresh(), { type: 'checklist', id: 'b', state: 'missing' }, { type: 'setCurrent', stepId: 's7' }, { type: 'server', server });
    expect(s.progress.checklist).toEqual({ a: 'have', b: 'missing' });
    expect(s.progress.currentStepId).toBe('s7');
  });
  it('a confirmed save at the current revision clears dirty state and adopts the server copy (newer progress tolerated)', () => {
    let s = run(fresh(), { type: 'complete', stepId: 's1' });
    s = progressReducer(s, { type: 'saved', rev: s.rev, server });
    expect(s.dirty).toBe(false);
    expect(s.removed).toEqual([]);
    expect(s.progress).toEqual(server);
  });
  it('a save confirmed after further edits stays dirty and keeps the newer edits', () => {
    let s = run(fresh(), { type: 'complete', stepId: 's1' });
    const savedRev = s.rev;
    s = run(s, { type: 'complete', stepId: 's4' });
    s = progressReducer(s, { type: 'saved', rev: savedRev, server: { currentStepId: null, completedStepIds: ['s1'], checklist: {} } });
    expect(s.dirty).toBe(true);
    expect(s.progress.completedStepIds).toEqual(['s1', 's4']);
  });
});
