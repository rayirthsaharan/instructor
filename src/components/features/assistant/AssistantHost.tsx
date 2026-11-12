'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { BottomSheet, ConfirmDialog, Icon, IconButton } from '@/components/ui';
import { keyboardInset } from '@/lib/client/assistant';
import { getOwn } from '@/lib/guide/selectors';
import { stepPosition } from '../player/model';
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

/** Desktop: docked in the right column, not modal. Step title and instruction pinned (collapsible), chat below. */
export function AssistantDock(p: AssistantViewProps & { onClose: () => void }) {
  const clear = useClear(p.assistant.clear);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const step = getOwn(p.guide.steps, p.stepId);
  const number = stepPosition(p.guide, p.stepId).number;

  // Focus moves into the dock on open and goes back to the Ask button on close.
  useEffect(() => {
    heading.current?.focus();
    return () => {
      document.querySelector<HTMLElement>('[data-testid="ask-button"]')?.focus();
    };
  }, []);

  if (!step) return null;
  return (
    <>
      <section
        aria-labelledby={headingId}
        data-testid="assistant-dock"
        className="flex min-h-0 flex-1 flex-col bg-surface"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            p.onClose();
          }
        }}
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line pl-4 pr-2">
          <h2 id={headingId} ref={heading} tabIndex={-1} className="type-display-md outline-none focus-visible:outline-2">
            {COPY.title}
          </h2>
          <IconButton icon="close" aria-label="Close" onClick={p.onClose} data-testid="dock-close" />
        </header>
        <div className="shrink-0 border-b border-line">
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
            className="flex min-h-14 w-full cursor-pointer items-center gap-2 px-4 text-left t-fast hover:bg-surface-sunken"
            data-testid="dock-step-toggle"
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={20} />
            <span className="min-w-0 flex-1">
              <span className="type-label block text-ink-muted" data-testid="context-label">
                ABOUT STEP {number}
              </span>
              <span className="type-body block truncate font-semibold" data-testid="context-title">
                {step.title}
              </span>
            </span>
          </button>
          {!collapsed && (
            <p className="type-body max-h-28 overflow-y-auto px-4 pb-3 pl-11 text-ink" data-testid="dock-instruction">
              {step.instruction}
            </p>
          )}
        </div>
        {clear.failed && failNote}
        <AssistantPanel {...p} showStrip={false} onClear={clear.ask} />
      </section>
      {clear.dialog}
    </>
  );
}
