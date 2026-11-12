import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

/** Filter / suggestion chip: 36 visual inside a 44 hit area (DS 7.3). */
export function Chip({
  selected = false,
  children,
  className,
  type = 'button',
  ...rest
}: { selected?: boolean; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn('group inline-flex h-11 items-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed', className)}
      {...rest}
    >
      <span
        className={cn(
          'inline-flex h-9 items-center gap-1 rounded-sm border px-3 type-body-sm font-semibold t-fast',
          selected
            ? 'bg-accent-soft border-accent text-accent'
            : 'bg-surface border-ink-subtle text-ink group-enabled:group-hover:bg-surface-sunken',
        )}
      >
        {selected && <Icon name="check" size={20} />}
        {children}
      </span>
    </button>
  );
}

export type PartChipProps = {
  name: string;
  /** "x4"-style quantity text; omit when neither the step nor the part gives one. */
  quantity?: string;
  /** Manual's own label ("A", "104321"). Never synthesise one. */
  manualLabel?: string;
  /** 1-based number of the callout on the picture that marks this part (DS 7.3); omit when nothing marks it. */
  calloutNumber?: number;
  selected?: boolean;
  /** User marked the part missing in prep. */
  missing?: boolean;
  /** Tool chip: wrench icon in the marker position. */
  tool?: boolean;
  /** For tools: false renders "Not in the box". */
  included?: boolean;
  onSelect?: () => void;
  className?: string;
};

/** Part / tool chip (DS 7.3). Tap selects; the second tap (handled by the parent) opens the Part sheet. */
export function PartChip({
  name,
  quantity,
  manualLabel,
  calloutNumber,
  selected = false,
  missing = false,
  tool = false,
  included = true,
  onSelect,
  className,
}: PartChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'inline-flex h-12 max-w-full cursor-pointer items-center gap-2 rounded-sm border px-2 text-left t-fast',
        missing
          ? 'bg-warn-soft border-warn-fg text-ink'
          : selected
            ? 'bg-accent-soft border-accent text-ink'
            : 'bg-surface border-ink-subtle text-ink hover:bg-surface-sunken',
        className,
      )}
    >
      {quantity && <span className="type-tag rounded-xs bg-surface-sunken px-1.5 py-1 text-ink">{quantity}</span>}
      {tool ? (
        <Icon name="wrench" size={20} className="text-ink-muted" />
      ) : (
        calloutNumber !== undefined && (
          <span
            data-testid="chip-marker"
            aria-hidden="true"
            className="type-tag flex size-6 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'var(--mark-callout-bg)', color: 'var(--mark-callout-fg)' }}
          >
            {calloutNumber}
          </span>
        )
      )}
      {missing && <Icon name="warn" size={20} className="text-warn-fg" />}
      <span className="min-w-0 truncate font-semibold">{name}</span>
      {missing && <span className="type-body-sm font-semibold text-warn-fg">Missing</span>}
      {tool && !included && <span className="type-body-sm text-ink-muted whitespace-nowrap">Not in the box</span>}
      {manualLabel && <span className="type-tag min-w-0 max-w-[40%] shrink-0 truncate text-ink-muted">{manualLabel}</span>}
    </button>
  );
}
