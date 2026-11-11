'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const SETTLE_MS = 1500;

/**
 * After a client-side route change, moves keyboard and screen-reader focus to the page's h1 so it is not left
 * on <body>. Screens that swap their h1 while loading (skeleton -> content) get focus again, but only while the
 * user has not yet interacted. The first load of the app is not a route change and is left alone.
 */
export function RouteFocus() {
  const pathname = usePathname();
  const previous = useRef(pathname);

  useEffect(() => {
    // Strict mode re-runs effects on mount: only a changed pathname is a route change.
    if (previous.current === pathname) return;
    previous.current = pathname;
    const focusHeading = (force = false) => {
      const active = document.activeElement;
      if (!force && active && active !== document.body && document.contains(active)) return;
      const h1 = document.querySelector('h1');
      if (!h1) return;
      if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    };
    focusHeading(true);
    const observer = new MutationObserver(() => focusHeading());
    observer.observe(document.body, { childList: true, subtree: true });
    const stop = () => observer.disconnect();
    const timer = window.setTimeout(stop, SETTLE_MS);
    window.addEventListener('keydown', stop, { once: true });
    window.addEventListener('pointerdown', stop, { once: true });
    return () => {
      stop();
      window.clearTimeout(timer);
      window.removeEventListener('keydown', stop);
      window.removeEventListener('pointerdown', stop);
    };
  }, [pathname]);

  return null;
}
