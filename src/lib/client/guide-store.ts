'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ValidatedGuide } from '@/lib/guide/validate';
import { ApiError } from './api';

export type ChecklistState = 'unchecked' | 'have' | 'missing';
export type SaveState = 'idle' | 'saving' | 'error';
export type GuideStatus = 'loading' | 'ready' | 'error' | 'not_found';

export interface GuideProgress {
  currentStepId: string | null;
  completedStepIds: string[];
  checklist: Record<string, ChecklistState>;
}

/** Local progress plus what has changed since the last confirmed save (needed to merge a newer server copy). */
export interface ProgressState {
  progress: GuideProgress;
  /** Increments on every local change. */
  rev: number;
  /** Local changes not yet confirmed by the server. */
  dirty: boolean;
  /** Steps un-completed locally since the last confirmed save, so a stale server copy cannot bring them back. */
  removed: string[];
  /** Checklist ids / current step changed locally since the last confirmed save. */
  touchedChecklist: string[];
  currentTouched: boolean;
}

export const EMPTY_PROGRESS: GuideProgress = { currentStepId: null, completedStepIds: [], checklist: {} };

export function initialProgressState(progress: GuideProgress = EMPTY_PROGRESS): ProgressState {
  return {
    progress: normalise(progress),
    rev: 0,
    dirty: false,
    removed: [],
    touchedChecklist: [],
    currentTouched: false,
  };
}

function normalise(p: Partial<GuideProgress> | null | undefined): GuideProgress {
  return {
    currentStepId: p?.currentStepId ?? null,
    completedStepIds: [...new Set(p?.completedStepIds ?? [])],
    checklist: { ...(p?.checklist ?? {}) },
  };
}

export type ProgressAction =
  | { type: 'setCurrent'; stepId: string }
  | { type: 'complete'; stepId: string }
  | { type: 'uncomplete'; stepId: string }
  | { type: 'checklist'; id: string; state: ChecklistState }
  /** The server confirmed a save made at `rev` and returned its copy. */
  | { type: 'saved'; rev: number; server: GuideProgress }
  /** A server copy arrived without a matching save (initial load or refresh). */
  | { type: 'server'; server: GuideProgress };

const add = (list: string[], v: string) => (list.includes(v) ? list : [...list, v]);

/**
 * Pure reducer. Rules:
 * - completing is idempotent, never drops other completed steps;
 * - a server copy never removes a locally completed step that is still unsaved (union),
 *   and never resurrects a step the user has un-completed since the last save;
 * - with no unsaved local changes the server copy wins outright.
 */
export function progressReducer(state: ProgressState, action: ProgressAction): ProgressState {
  const p = state.progress;
  switch (action.type) {
    case 'setCurrent':
      if (p.currentStepId === action.stepId) return state;
      return { ...state, rev: state.rev + 1, dirty: true, currentTouched: true, progress: { ...p, currentStepId: action.stepId } };
    case 'complete': {
      if (p.completedStepIds.includes(action.stepId)) return state;
      return {
        ...state,
        rev: state.rev + 1,
        dirty: true,
        removed: state.removed.filter((s) => s !== action.stepId),
        progress: { ...p, completedStepIds: [...p.completedStepIds, action.stepId] },
      };
    }
    case 'uncomplete': {
      if (!p.completedStepIds.includes(action.stepId)) return state;
      return {
        ...state,
        rev: state.rev + 1,
        dirty: true,
        removed: add(state.removed, action.stepId),
        progress: { ...p, completedStepIds: p.completedStepIds.filter((s) => s !== action.stepId) },
      };
    }
    case 'checklist': {
      if ((p.checklist[action.id] ?? 'unchecked') === action.state) return state;
      return {
        ...state,
        rev: state.rev + 1,
        dirty: true,
        touchedChecklist: add(state.touchedChecklist, action.id),
        progress: { ...p, checklist: { ...p.checklist, [action.id]: action.state } },
      };
    }
    case 'saved': {
      // Changes made while the request was in flight stay dirty and are merged over the server copy.
      if (action.rev === state.rev) {
        // Even a confirmed save is merged, never adopted blindly: a completed step is never lost.
        return { ...mergeServer(state, action.server), dirty: false, removed: [], touchedChecklist: [], currentTouched: false };
      }
      return mergeServer(state, action.server);
    }
    case 'server':
      return state.dirty ? mergeServer(state, action.server) : { ...state, progress: normalise(action.server) };
  }
}

function mergeServer(state: ProgressState, serverRaw: GuideProgress): ProgressState {
  const server = normalise(serverRaw);
  const local = state.progress;
  const removed = new Set(state.removed);
  const completed = [...server.completedStepIds.filter((s) => !removed.has(s))];
  for (const s of local.completedStepIds) if (!completed.includes(s)) completed.push(s);
  const checklist = { ...server.checklist };
  for (const id of state.touchedChecklist) {
    const v = Object.hasOwn(local.checklist, id) ? local.checklist[id] : undefined;
    if (v) checklist[id] = v;
  }
  return {
    ...state,
    progress: {
      currentStepId: state.currentTouched ? local.currentStepId : (server.currentStepId ?? local.currentStepId),
      completedStepIds: completed,
      checklist,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Store (one per guide, shared by Overview, player and done)

export const SAVE_DEBOUNCE_MS = 600;
export const RETRY_DELAYS_MS = [2000, 5000, 15000];

export interface GuideSnapshot {
  status: GuideStatus;
  guide: ValidatedGuide | null;
  pageCount: number;
  documentId: string | null;
  progress: GuideProgress;
  saveState: SaveState;
  /** True only once automatic retries are exhausted (or pointless): the point at which the UI shows its error banner. */
  saveFailed: boolean;
}

interface Net {
  load(id: string): Promise<{ documentId: string; guide: ValidatedGuide; progress: GuideProgress; pageCount: number }>;
  save(id: string, body: GuideProgress, opts: { keepalive: boolean }): Promise<GuideProgress>;
}

const url = (id: string) => `/api/guides/${encodeURIComponent(id)}`;

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

const defaultNet: Net = {
  async load(id) {
    let res: Response;
    try {
      res = await fetch(url(id), { cache: 'no-store' });
    } catch {
      throw new ApiError('network', 'Network error');
    }
    const body = (await readJson(res)) as
      | { documentId?: string; guide?: ValidatedGuide; progress?: GuideProgress; pageCount?: number; error?: { code?: string; message?: string } }
      | null;
    if (!res.ok) throw new ApiError(res.status === 404 ? 'not_found' : (body?.error?.code ?? 'unknown'), body?.error?.message ?? 'Request failed', res.status);
    if (!body?.guide || !body.documentId) throw new ApiError('unknown', 'Unexpected response', res.status);
    return { documentId: body.documentId, guide: body.guide, progress: normalise(body.progress), pageCount: body.pageCount ?? 0 };
  },
  async save(id, body, { keepalive }) {
    let res: Response;
    try {
      res = await fetch(`${url(id)}/progress`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        keepalive,
      });
    } catch {
      throw new ApiError('network', 'Network error');
    }
    const json = (await readJson(res)) as (Partial<GuideProgress> & { error?: { code?: string; message?: string } }) | null;
    if (!res.ok) throw new ApiError(json?.error?.code ?? 'unknown', json?.error?.message ?? 'Save failed', res.status);
    return normalise(json);
  },
};

export class GuideStore {
  private snap: GuideSnapshot = {
    status: 'loading',
    guide: null,
    pageCount: 0,
    documentId: null,
    progress: EMPTY_PROGRESS,
    saveState: 'idle',
    saveFailed: false,
  };
  private ps = initialProgressState();
  private listeners = new Set<() => void>();
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryCount = 0;
  private inFlight = false;
  private started = false;
  private flushAfterFlight = false;

  constructor(
    readonly id: string,
    private net: Net = defaultNet,
    private timers: { debounceMs: number; retryDelays: number[] } = { debounceMs: SAVE_DEBOUNCE_MS, retryDelays: RETRY_DELAYS_MS },
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
      // Leaving a route: persist right away rather than waiting for the debounce.
      if (this.listeners.size === 0) this.flush();
    };
  };
  getSnapshot = () => this.snap;

  private emit(patch: Partial<GuideSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l();
  }

  private syncProgress() {
    this.emit({ progress: this.ps.progress });
  }

  async load() {
    if (this.started && this.snap.status !== 'error') return;
    this.started = true;
    this.emit({ status: 'loading' });
    try {
      const r = await this.net.load(this.id);
      this.ps = progressReducer(this.ps, { type: 'server', server: r.progress });
      this.emit({ status: 'ready', guide: r.guide, documentId: r.documentId, pageCount: r.pageCount, progress: this.ps.progress });
    } catch (e) {
      this.emit({ status: e instanceof ApiError && e.code === 'not_found' ? 'not_found' : 'error' });
    }
  }

  reload() {
    this.started = false;
    return this.load();
  }

  private dispatch(a: ProgressAction) {
    const next = progressReducer(this.ps, a);
    if (next === this.ps) return;
    this.ps = next;
    this.syncProgress();
    this.retryCount = 0;
    this.schedule();
  }

  setCurrentStep = (stepId: string) => this.dispatch({ type: 'setCurrent', stepId });
  completeStep = (stepId: string) => this.dispatch({ type: 'complete', stepId });
  uncompleteStep = (stepId: string) => this.dispatch({ type: 'uncomplete', stepId });
  setChecklistItem = (id: string, state: ChecklistState) => this.dispatch({ type: 'checklist', id, state });

  private schedule() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.flush(), this.timers.debounceMs);
  }

  /** Send unsaved changes now. `keepalive` is used when the page is being hidden. */
  flush = (keepalive = false): Promise<void> => {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = undefined;
    if (!this.ps.dirty || this.snap.status !== 'ready') return Promise.resolve();
    if (this.inFlight) {
      this.flushAfterFlight = true;
      return Promise.resolve();
    }
    return this.send(keepalive);
  };

  retrySave = () => {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.retryCount = 0;
    return this.flush();
  };

  private async send(keepalive: boolean) {
    const rev = this.ps.rev;
    this.inFlight = true;
    this.emit({ saveState: 'saving', saveFailed: false });
    try {
      const server = await this.net.save(this.id, this.ps.progress, { keepalive });
      this.ps = progressReducer(this.ps, { type: 'saved', rev, server });
      this.retryCount = 0;
      this.inFlight = false;
      this.emit({ progress: this.ps.progress, saveState: this.ps.dirty ? 'saving' : 'idle', saveFailed: false });
      if (this.ps.dirty) void this.flush();
    } catch (e) {
      this.inFlight = false;
      // The server rejected the content (4xx other than rate limits): retrying the same body cannot help.
      const permanent = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 408;
      const delay = this.timers.retryDelays[this.retryCount];
      if (!permanent && delay !== undefined && !this.retryTimer) {
        this.retryCount += 1;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          void this.flush();
        }, delay);
      }
      // Waiting for retrySave (nothing scheduled): only now is the failure shown to the user.
      this.emit({ saveState: 'error', saveFailed: !this.retryTimer });
    }
    if (this.flushAfterFlight) {
      this.flushAfterFlight = false;
      if (this.snap.saveState !== 'error') void this.flush();
    }
  }

  dispose() {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }
}

// ---------------------------------------------------------------------------------------------
// Shared registry + React hook

const stores = new Map<string, GuideStore>();
let pageListenersAttached = false;

function attachPageListeners() {
  if (pageListenersAttached || typeof window === 'undefined') return;
  pageListenersAttached = true;
  const flushAll = () => stores.forEach((s) => void s.flush(true));
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}

export function getGuideStore(guideId: string): GuideStore {
  let s = stores.get(guideId);
  if (!s) {
    s = new GuideStore(guideId);
    stores.set(guideId, s);
  }
  return s;
}

/** Test helper: forget all shared stores. */
export function resetGuideStores() {
  stores.forEach((s) => s.dispose());
  stores.clear();
}

export function useGuide(guideId: string) {
  const store = getGuideStore(guideId);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    attachPageListeners();
    void store.load();
  }, [store]);
  const retry = useCallback(() => void store.reload(), [store]);
  return {
    status: snap.status,
    guide: snap.guide,
    pageCount: snap.pageCount,
    documentId: snap.documentId,
    progress: snap.progress,
    setCurrentStep: store.setCurrentStep,
    completeStep: store.completeStep,
    uncompleteStep: store.uncompleteStep,
    setChecklistItem: store.setChecklistItem,
    saveState: snap.saveState,
    saveFailed: snap.saveFailed,
    retrySave: store.retrySave,
    /** Reload the guide after a load error. */
    reload: retry,
  };
}
