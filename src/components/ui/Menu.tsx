'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { cn } from './cn';
import { IconButton } from './IconButton';

export type MenuItem = {
  label: string;
  onSelect: () => void;
  /** Destructive rows use `danger-fg` (DS 7.15). */
  danger?: boolean;
  disabled?: boolean;
  /** Switch rows (e.g. "Keep screen on"): rendered as menuitemcheckbox with an On / Off state. */
  checked?: boolean;
  /** Helper text under the label. */
  description?: string;
};

const MENU_WIDTH = 192;

/** Overflow menu (DS 7.15): `surface-raised`, elev-2, radius sm, rows 48. Esc closes and restores focus. */
export function Menu({
  label,
  items,
  placement = 'below',
  width = MENU_WIDTH,
  className,
}: {
  /** Accessible name of the trigger, e.g. "More actions for Flat-pack wardrobe". */
  label: string;
  items: MenuItem[];
  placement?: 'below' | 'above';
  /** Menu width in px (default 192). */
  width?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const first = rootRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])');
    first?.focus();
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onMove = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  const close = (restore: boolean) => {
    setOpen(false);
    if (restore) triggerRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const rows = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? []);
      if (rows.length === 0) return;
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows[next]?.focus();
    }
  };

  return (
    <div ref={rootRef} className={className} onKeyDown={onKeyDown}>
      <IconButton
        ref={triggerRef}
        icon="more"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          const r = triggerRef.current?.getBoundingClientRect();
          if (r) {
            // Fixed position, clamped to the viewport, so a tile in the first or last column never clips the menu.
            const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
            setPos(
              placement === 'above'
                ? { left, bottom: window.innerHeight - r.top + 4 }
                : { left, top: r.bottom + 4 },
            );
          }
          setOpen((o) => !o);
        }}
      />
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          style={{ ...pos, width }}
          className="fixed z-30 overflow-hidden rounded-sm border border-line bg-surface-raised py-1 shadow-elev-2"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked}
              disabled={it.disabled}
              onClick={() => {
                close(true);
                it.onSelect();
              }}
              className={cn(
                'type-body flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 px-4 py-1 text-left t-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-transparent',
                it.danger ? 'text-danger-fg' : 'text-ink',
              )}
            >
              <span className="min-w-0">
                {it.label}
                {it.description && <span className="type-body-sm block text-ink-muted">{it.description}</span>}
              </span>
              {it.checked !== undefined && <span className="type-tag shrink-0 text-ink-muted">{it.checked ? 'On' : 'Off'}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
