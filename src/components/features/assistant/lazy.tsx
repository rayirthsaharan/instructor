'use client';

import dynamic from 'next/dynamic';

// The assistant UI (dock, sheet, chat, composer) is loaded when Ask is first opened, or when the browser is idle after the
// player is interactive, so it is not part of the player's first load.
const load = () => import('./AssistantHost');

// Holds the dock's column while its code loads, so the picture does not jump twice.
const DockPlaceholder = () => <aside aria-hidden="true" className="w-[320px] shrink-0 border-r border-line bg-surface min-[1200px]:w-[360px] min-[1440px]:w-[400px]" />;

export const LazyAssistantDock = dynamic(() => load().then((m) => m.AssistantDock), { ssr: false, loading: DockPlaceholder });
export const LazyAssistantSheet = dynamic(() => load().then((m) => m.AssistantSheet), { ssr: false });

/** Fetches the assistant code without rendering it. Safe to call repeatedly. */
export function preloadAssistant(): void {
  void load();
}
