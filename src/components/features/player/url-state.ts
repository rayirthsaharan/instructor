// URL state of the Step player: /g/[id]/play?step=<stepId>&panel=steps|original|ask&page=<n>.
// The URL is the single source of truth for step and overlay, so Back, refresh and links all work.

export type PanelName = 'steps' | 'original' | 'ask';
const PANELS: readonly PanelName[] = ['steps', 'original', 'ask'];

export interface PlayerUrl {
  step: string | null;
  panel: PanelName | null;
  /** 1-based page of the Original viewer; only meaningful with panel=original. */
  page: number | null;
}

export function parsePlayerSearch(search: string | URLSearchParams): PlayerUrl {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  const step = p.get('step');
  const rawPanel = p.get('panel');
  const panel = PANELS.find((x) => x === rawPanel) ?? null;
  const rawPage = p.get('page');
  const n = rawPage !== null && /^\d{1,6}$/.test(rawPage) ? Number(rawPage) : NaN;
  return {
    step: step && step.length <= 100 ? step : null,
    panel,
    page: panel === 'original' && Number.isInteger(n) && n >= 1 ? n : null,
  };
}

/**
 * New query string (with leading "?") after applying `patch`. Unknown params are kept. Clearing the panel clears
 * the page; a page is only written together with panel=original.
 */
export function withPlayerSearch(search: string | URLSearchParams, patch: Partial<PlayerUrl>): string {
  const p = new URLSearchParams(typeof search === 'string' ? search : search.toString());
  if ('step' in patch) {
    if (patch.step) p.set('step', patch.step);
    else p.delete('step');
  }
  if ('panel' in patch) {
    if (patch.panel) p.set('panel', patch.panel);
    else p.delete('panel');
  }
  const panel = p.get('panel');
  if (panel !== 'original') p.delete('page');
  else if ('page' in patch) {
    if (patch.page && patch.page >= 1) p.set('page', String(Math.floor(patch.page)));
    else p.delete('page');
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
