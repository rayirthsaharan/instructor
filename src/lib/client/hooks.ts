'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, getDocument, listGuides } from './api';
import { POLL_MIN_MS, SLOW_AFTER_MS, isInFlight, nextDelay } from './poll';
import type { DocumentState, GuideSummary } from './types';

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Touch-first devices get the camera button (DS 7.9). */
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)');
/** >= 1024px (DS lg). */
export const useIsDesktop = () => useMediaQuery('(min-width: 64rem)');

export type GuidesState =
  | { status: 'loading'; guides: [] }
  | { status: 'error'; guides: [] }
  | { status: 'ready'; guides: GuideSummary[] };

const GUIDES_POLL_MS = 3000;

/** Loads the library and keeps refreshing while any manual is still being read. */
export function useGuides() {
  const [state, setState] = useState<GuidesState>({ status: 'loading', guides: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loaded = false;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const guides = await listGuides(ctrl.signal);
        if (stopped) return;
        loaded = true;
        setState({ status: 'ready', guides });
        if (guides.some((g) => isInFlight(g.status))) timer = setTimeout(load, GUIDES_POLL_MS);
      } catch {
        if (stopped) return;
        // A failed background refresh keeps what is on screen; only the first load shows the error.
        if (loaded) timer = setTimeout(load, GUIDES_POLL_MS * 2);
        else setState({ status: 'error', guides: [] });
      }
    };
    void load();
    return () => {
      stopped = true;
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading', guides: [] });
    setAttempt((n) => n + 1);
  }, []);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload, refresh };
}

export interface DocumentPoll {
  doc: DocumentState | null;
  notFound: boolean;
  /** The last request failed; polling continues silently. */
  reconnecting: boolean;
  /** Stage unchanged for more than 60 s. */
  slow: boolean;
  /** Restart polling (after Retry). */
  restart: () => void;
}

/**
 * Polls the job with backoff. The server is the only source of truth: nothing here survives a reload.
 * Stops on a terminal status (ready, failed, rejected); resumes when the tab becomes visible again.
 */
export function useDocumentPolling(id: string): DocumentPoll {
  const [s, setS] = useState({ doc: null as DocumentState | null, notFound: false, reconnecting: false, slow: false });
  const [run, setRun] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = POLL_MIN_MS;
    let lastSig: string | null = null;
    let lastStage: string | null = null;
    let stageSince = Date.now();
    const ctrl = new AbortController();

    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      let terminal = false;
      try {
        const d = await getDocument(id, ctrl.signal);
        if (stopped) return;
        busy = false;
        const sig = `${d.status}|${d.stage}|${d.progress}|${d.pagesRendered}`;
        const stageKey = `${d.status}|${d.stage}`;
        if (stageKey !== lastStage) {
          lastStage = stageKey;
          stageSince = Date.now();
        }
        delay = nextDelay(delay, sig !== lastSig ? 'changed' : 'same');
        lastSig = sig;
        terminal = !isInFlight(d.status) && !(d.status === 'ready' && !d.guideId);
        setS({
          doc: d,
          notFound: false,
          reconnecting: false,
          slow: !terminal && Date.now() - stageSince > SLOW_AFTER_MS,
        });
      } catch (e) {
        busy = false;
        if (stopped) return;
        if (e instanceof ApiError && e.code === 'not_found') {
          setS({ doc: null, notFound: true, reconnecting: false, slow: false });
          return;
        }
        delay = nextDelay(delay, 'error');
        setS((p) => ({ ...p, reconnecting: true }));
      }
      if (!stopped && !terminal) timer = setTimeout(poll, delay);
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible' || stopped) return;
      if (timer) clearTimeout(timer);
      delay = POLL_MIN_MS;
      void poll();
    };

    void poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      ctrl.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id, run]);

  const restart = useCallback(() => setRun((n) => n + 1), []);
  return { ...s, restart };
}
