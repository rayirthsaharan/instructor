'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { BottomSheet, ConfirmDialog, IconButton } from '@/components/ui';
import { keyboardInset } from '@/lib/client/assistant';
import { getOwn } from '@/lib/guide/selectors';
import { AssistantPanel, type AssistantViewProps } from './AssistantPanel';
import { COPY } from './copy';

/** Pixels covered by the on-screen keyboard (0 when there is none or the browser resizes the page itself). */
export function useKeyboardInset(): number {
  return useSyncExternalStore(
    (cb) => {
      const vv = window.visualViewport;
      vv?.addEventListener('resize', cb);
      vv?.addEventListener('scroll', cb);
      return () => {
        vv?.removeEventListener('resize', cb);
        vv?.removeEventListener('scroll', cb);
      };
    },
    () => {
      const vv = window.visualViewport;
      return vv ? keyboardInset(window.innerHeight, vv.height, vv.offsetTop) : 0;
    },
    () => 0,
  );
}

/** "Clear conversation" with its confirm dialog; rendered beside (not inside) the sheet so focus traps stay separate. */
function useClear(clear: () => Promise<boolean>) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = (
    <ConfirmDialog
      open={confirming}
      onCancel={() => setConfirming(false)}
      onConfirm={async () => {
        setConfirming(false);
        setFailed(!(await clear()));
      }}
      title={COPY.clearTitle}
      message={COPY.clearMessage}
      confirmLabel={COPY.clearConfirm}
    />
  );
  return {
    ask: () => {
      setFailed(false);
      setConfirming(true);
    },
    dialog,
    failed,
  };
}

const failNote = (
  <p role="alert" className="type-body-sm border-t border-line bg-danger-soft px-4 py-2 text-danger-fg" data-testid="clear-failed">
    {COPY.clearFailed}
  </p>
);

/** Phone and tablet: the assistant is a bottom sheet over the player (opens at the full detent for the keyboard). */
export function AssistantSheet(p: AssistantViewProps & { open: boolean; onClose: () => void }) {
  const clear = useClear(p.assistant.clear);
  const inset = useKeyboardInset();
  return (
    <>
      <BottomSheet open={p.open} onClose={p.onClose} title={COPY.title} initialDetent="full" lgPresentation="panel" bare keyboardInset={inset}>
        {clear.failed && failNote}
        <AssistantPanel {...p} onClear={clear.ask} onStripTap={p.onClose} />
      </BottomSheet>
      {clear.dialog}
    </>
  );
}

/** Desktop: the assistant takes the step rail's place in the left column (USER_FLOWS 7). Not modal, no animation. */
export function AssistantDock(p: AssistantViewProps & { onClose: () => void }) {
  const clear = useClear(p.assistant.clear);
  const headingId = useId();
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Focus goes to the composer on open (the heading when it is disabled) and back to the Ask button on close.
  useEffect(() => {
    const input = root.current?.querySelector<HTMLElement>('[data-testid="composer-input"]');
    if (input && !(input as HTMLTextAreaElement).disabled) input.focus();
    else heading.current?.focus();
    return () => {
      document.querySelector<HTMLElement>('[data-testid="ask-button"]')?.focus();
    };
  }, []);

  if (!getOwn(p.guide.steps, p.stepId)) return null;
  return (
    <>
      <aside
        ref={root}
        aria-labelledby={headingId}
        data-testid="assistant-dock"
        className="flex w-[320px] shrink-0 flex-col border-r border-line bg-surface min-[1200px]:w-[360px] min-[1440px]:w-[400px]"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            p.onClose();
          }
        }}
      >
        <header data-testid="dock-header" className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line pl-4 pr-2">
          <h2 id={headingId} ref={heading} tabIndex={-1} className="type-display-md outline-none focus-visible:outline-2">
            {COPY.title}
          </h2>
          <IconButton icon="close" aria-label="Close the assistant" onClick={p.onClose} data-testid="dock-close" />
        </header>
        {clear.failed && failNote}
        <AssistantPanel {...p} showStrip={false} onClear={clear.ask} />
      </aside>
      {clear.dialog}
    </>
  );
}
