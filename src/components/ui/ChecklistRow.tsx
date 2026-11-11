import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Skeleton } from './Skeleton';

export type ChecklistStatus = 'unchecked' | 'have' | 'missing';

export type ChecklistRowProps = {
  name: string;
  status: ChecklistStatus;
  manualLabel?: string;
  quantity?: string;
  thumbnailSrc?: string;
  /** Steps that need this part, rendered as links on the third line when missing. */
  neededInSteps?: Array<{ step: number; href: string }>;
  onToggle?: () => void;
  /** Opens the overflow menu ("I'm missing this", "Show in manual"). */
  onOverflow?: () => void;
  className?: string;
};

/** Checklist row (DS 7.4): a role=checkbox target, a separate overflow button, optional links line. */
export function ChecklistRow({
  name,
  status,
  manualLabel,
  quantity,
  thumbnailSrc,
  neededInSteps,
  onToggle,
  onOverflow,
  className,
}: ChecklistRowProps) {
  const missing = status === 'missing';
  return (
    <div
      className={cn(
        'rounded-md border border-line px-3 py-1 t-fast',
        missing ? 'bg-warn-soft' : 'bg-surface hover:bg-surface-sunken active:bg-surface-sunken',
        className,
      )}
    >
      <div className="flex min-h-14 items-center gap-1">
        <button
          type="button"
          role="checkbox"
          aria-checked={status === 'have'}
          onClick={onToggle}
          className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-sm text-left"
        >
          {missing ? (
            <span className="flex size-7 shrink-0 items-center justify-center text-warn-fg">
              <Icon name="warn" size={28} />
            </span>
          ) : (
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-xs border-2 t-instant',
                status === 'have'
                  ? 'border-success-solid bg-success-solid text-success-on'
                  : 'border-ink-subtle bg-surface',
              )}
            >
              {status === 'have' && <Icon name="check" size={20} />}
            </span>
          )}
          {thumbnailSrc && (
            // eslint-disable-next-line @next/next/no-img-element -- small crop of a user page, size known
            <img src={thumbnailSrc} alt="" width={48} height={48} className="size-12 shrink-0 rounded-xs border border-line bg-white object-contain" />
          )}
          <span className="min-w-0">
            <span className="block font-semibold">{name}</span>
            {(manualLabel || quantity) && (
              <span className="type-tag block text-ink-muted">{[manualLabel, quantity].filter(Boolean).join(' ')}</span>
            )}
          </span>
          {missing && <span className="sr-only">Marked missing</span>}
        </button>
        {onOverflow && <IconButton icon="more" aria-label={`More options for ${name}`} onClick={onOverflow} />}
      </div>
      {missing && neededInSteps && neededInSteps.length > 0 && (
        <div className="type-body-sm flex flex-wrap items-center gap-2 pb-2 pl-10 text-ink-muted">
          <span>Needed in steps</span>
          {neededInSteps.map((s): ReactNode => (
            <a key={s.step} href={s.href} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xs px-2 text-accent underline">
              {s.step}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChecklistRowSkeleton() {
  return (
    <div role="status" className="flex min-h-14 items-center gap-3 rounded-md border border-line bg-surface px-3">
      <span className="sr-only">Loading</span>
      <Skeleton className="size-7 rounded-xs" />
      <Skeleton className="size-12" />
      <div className="flex-1 space-y-2" aria-hidden="true">
        <Skeleton className="h-4 w-3/4 rounded-xs" />
        <Skeleton className="h-3 w-1/3 rounded-xs" />
      </div>
    </div>
  );
}
