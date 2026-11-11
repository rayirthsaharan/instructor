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
};

const MENU_WIDTH = 192;

/** Overflow menu (DS 7.15): `surface-raised`, elev-2, radius sm, rows 48. Esc closes and restores focus. */
export function Menu({
  label,
  items,
  placement = 'below',
  className,
}: {
  /** Accessible name of the trigger, e.g. "More actions for Flat-pack wardrobe". */
  label: string;
  items: MenuItem[];
  placement?: 'below' | 'above';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const first = rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
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
      const rows = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
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
            const left = Math.max(8, Math.min(window.innerWidth - MENU_WIDTH - 8, r.right - MENU_WIDTH));
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
          style={{ ...pos, width: MENU_WIDTH }}
          className="fixed z-30 overflow-hidden rounded-sm border border-line bg-surface-raised py-1 shadow-elev-2"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                close(true);
                it.onSelect();
              }}
              className={cn(
                'type-body flex h-12 w-full cursor-pointer items-center px-4 text-left t-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-transparent',
                it.danger ? 'text-danger-fg' : 'text-ink',
              )}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
