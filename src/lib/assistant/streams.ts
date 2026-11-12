/** In-process gate for streaming answers: one at a time per guide, and a hard cap overall. */
const active = new Set<string>();

export type Acquired = { ok: true; release: () => void } | { ok: false; reason: 'busy' | 'full' };

export function acquireStream(guideId: string, maxStreams: number): Acquired {
  if (active.has(guideId)) return { ok: false, reason: 'busy' };
  if (active.size >= maxStreams) return { ok: false, reason: 'full' };
  active.add(guideId);
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      active.delete(guideId);
    },
  };
}
