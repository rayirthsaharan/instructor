'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
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

export function useViewportHeight(): number {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('resize', cb);
      return () => window.removeEventListener('resize', cb);
    },
    () => window.innerHeight,
    () => 0,
  );
}

export type PlayerLayout = 'phone' | 'tablet' | 'desktop' | 'landscape';

/** Layout by width (DS 6) plus the phone-landscape layout (height under 500 and landscape). */
export function usePlayerLayout(): PlayerLayout {
  const landscape = useMediaQuery('(max-height: 499.98px) and (orientation: landscape)');
  const lg = useMediaQuery('(min-width: 64rem)');
  const md = useMediaQuery('(min-width: 37.5rem)');
  if (landscape) return 'landscape';
  if (lg) return 'desktop';
  return md ? 'tablet' : 'phone';
}

/** Matches 1200px and up: the desktop rail is a full column there, an icon strip below. */
export const useWideRail = () => useMediaQuery('(min-width: 75rem)');

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** A boolean setting kept in localStorage. Reads after mount so server and first client render agree. */
export function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void, boolean] {
  const [value, setValue] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the stored setting after hydration
      if (raw !== null) setValue(raw === '1');
    } catch {
      /* storage unavailable: keep the default */
    }
    setLoaded(true);
  }, [key]);
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, v ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, set, loaded];
}

export type WakeState = 'active' | 'inactive' | 'unsupported';

/**
 * Screen Wake Lock while `enabled` (USER_FLOWS 6.4): requested on entering, again when the tab becomes visible,
 * released on leaving. Unsupported or refused degrades silently to 'inactive' / 'unsupported'.
 */
export function useWakeLock(enabled: boolean): WakeState {
  const [state, setState] = useState<WakeState>('inactive');
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: 'release', fn: () => void): void }> } };
    if (!nav.wakeLock) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection after mount
      setState('unsupported');
      return;
    }
    if (!enabled) {
      setState('inactive');
      return;
    }
    let cancelled = false;
    let lock: Awaited<ReturnType<NonNullable<typeof nav.wakeLock>['request']>> | null = null;
    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible' || lock) return;
      try {
        const l = await nav.wakeLock!.request('screen');
        if (cancelled) {
          void l.release().catch(() => {});
          return;
        }
        lock = l;
        setState('active');
        l.addEventListener('release', () => {
          lock = null;
          if (!cancelled) setState('inactive');
        });
      } catch {
        if (!cancelled) setState('inactive');
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [enabled]);
  return state;
}

const noop = () => () => {};

/** Read-aloud through speechSynthesis. `supported` is false (and the control hidden) where it is missing. */
export function useSpeech() {
  const supported = useSyncExternalStore(
    noop,
    () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined',
    () => false,
  );
  const [speaking, setSpeaking] = useState(false);
  const run = useRef(0);

  // speechSynthesis can throw (blocked, no voices, a policy): reading aloud is a convenience and must never break the page.
  const cancel = () => {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* nothing to cancel */
    }
  };

  const stop = useCallback(() => {
    run.current += 1;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (lines: string[], lang?: string) => {
      if (!supported || lines.length === 0) return;
      cancel();
      const id = ++run.current;
      setSpeaking(true);
      try {
        lines.forEach((text, i) => {
          const u = new SpeechSynthesisUtterance(text);
          if (lang) u.lang = lang;
          const end = () => {
            if (run.current === id && i === lines.length - 1) setSpeaking(false);
          };
          u.onend = end;
          u.onerror = end;
          window.speechSynthesis.speak(u);
        });
      } catch {
        if (run.current === id) setSpeaking(false);
      }
    },
    [supported],
  );

  useEffect(() => () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) cancel();
  }, []);

  return { supported, speaking, speak, stop };
}
