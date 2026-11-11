'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

/**
 * Disclosure (DS 7.15): full-width 48px row with a chevron (right closed, down open), `body` 600 label; the content
 * sits on `surface-sunken`, inset. `aria-expanded` on the trigger.
 */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
  onToggle,
  className,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn('border-t border-line', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open);
          onToggle?.(!open);
        }}
        className="type-body flex h-12 w-full cursor-pointer items-center gap-2 text-left font-semibold text-ink t-fast hover:bg-surface-sunken"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={20} />
        {label}
      </button>
      <div id={id} hidden={!open} className="mb-3 rounded-sm bg-surface-sunken p-3">
        <div className="type-body-lg flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}
