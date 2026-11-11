'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from './cn';
import { Button } from './Button';
import { IconButton } from './IconButton';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside the dialog (native modal dialogs otherwise let focus escape to browser UI). */
function trapTab(e: KeyboardEvent<HTMLDialogElement>) {
  if (e.key !== 'Tab') return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === e.currentTarget)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Opens/closes a native modal <dialog> from the `open` prop. Native: inert background, Esc, focus restore. */
function useModalDialog(open: boolean, onFocusOpen: (d: HTMLDialogElement) => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const focusRef = useRef(onFocusOpen);
  useEffect(() => {
    focusRef.current = onFocusOpen;
  });
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      focusRef.current(d);
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);
  return ref;
}

export type DetentName = 'half' | 'full';

/**
 * Bottom sheet (DS 7.7): role=dialog + aria-modal, labelled by its title, focus moves to the title on open,
 * Tab is trapped, Esc / scrim tap / close button dismiss, and focus returns to the invoking control.
 * Drag the handle to switch detents (half 56vh, full 100vh - 48px) or down to dismiss.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  initialDetent = 'half',
  lgPresentation = 'dialog',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  initialDetent?: DetentName;
  /** At >= 1024px: 400px right-side panel or centred dialog (max 560). */
  lgPresentation?: 'panel' | 'dialog';
}) {
  const titleId = useId();
  const [detent, setDetent] = useState<DetentName>(initialDetent);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<number | null>(null);
  const ref = useModalDialog(open, (d) => d.querySelector<HTMLElement>('[data-sheet-title]')?.focus());

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    start.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (start.current !== null) setDrag(e.clientY - start.current);
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (start.current === null) return;
    const dy = e.clientY - start.current;
    const height = ref.current?.firstElementChild?.getBoundingClientRect().height ?? 1;
    start.current = null;
    setDrag(null);
    if (dy > height * 0.3) onClose();
    else if (dy > 40) setDetent('half');
    else if (dy < -40) setDetent('full');
  }

  return (
    <dialog
      ref={ref}
      className="sheet"
      data-lg={lgPresentation}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        // The native element closed itself (e.g. form method=dialog): keep the parent in sync.
        if (open) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={trapTab}
    >
      <div
        className="sheet-inner flex flex-col rounded-t-lg bg-surface-raised text-ink shadow-elev-2"
        style={{
          height: detent === 'half' ? '56dvh' : 'calc(100dvh - 48px)',
          maxHeight: 'calc(100dvh - 48px)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          transform: drag && drag > 0 ? `translateY(${drag}px)` : undefined,
        }}
      >
        <div
          className="flex h-11 shrink-0 cursor-grab touch-none items-center justify-center"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-hidden="true"
        >
          <div className="h-1 w-9 rounded-full bg-ink-subtle" />
        </div>
        <header className="flex items-center justify-between gap-2 px-4 pb-2">
          <h2 id={titleId} data-sheet-title tabIndex={-1} className="type-display-md outline-none focus-visible:outline-2">
            {title}
          </h2>
          <IconButton icon="close" aria-label="Close" onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">{children}</div>
        {footer && <footer className="shrink-0 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </dialog>
  );
}

/** Destructive confirm dialog (DS 7.15): title, one sentence, Cancel + Danger. Focus starts on Cancel. */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  message,
  confirmLabel,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
}) {
  const titleId = useId();
  const descId = useId();
  const ref = useModalDialog(open, (d) => d.querySelector<HTMLElement>('[data-autofocus]')?.focus());
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={trapTab}
    >
      <div className={cn('rounded-lg bg-surface-raised p-6 text-ink shadow-elev-2')}>
        <h2 id={titleId} className="type-display-md">
          {title}
        </h2>
        <p id={descId} className="type-body-lg mt-2 text-ink-muted">
          {message}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="secondary" onClick={onCancel} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
