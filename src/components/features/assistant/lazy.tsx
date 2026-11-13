'use client';

import dynamic from 'next/dynamic';

// The assistant UI (dock, sheet, chat, composer) is loaded when Ask is first opened, or when the browser is idle after the
// player is interactive, so it is not part of the player's first load.
const load = () => import('./AssistantHost');

export const LazyAssistantDock = dynamic(() => load().then((m) => m.AssistantDock), { ssr: false });
export const LazyAssistantSheet = dynamic(() => load().then((m) => m.AssistantSheet), { ssr: false });

/** Fetches the assistant code without rendering it. Safe to call repeatedly. */
export function preloadAssistant(): void {
  void load();
}
