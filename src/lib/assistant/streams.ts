/** In-process gate for streaming answers: one at a time per key (the session id), and a hard cap overall. */
const active = new Set<string>();

export type Acquired = { ok: true; release: () => void } | { ok: false; reason: 'busy' | 'full' };

export function acquireStream(key: string, maxStreams: number): Acquired {
  if (active.has(key)) return { ok: false, reason: 'busy' };
  if (active.size >= maxStreams) return { ok: false, reason: 'full' };
  active.add(key);
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      active.delete(key);
    },
  };
}
