'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { cn, Icon } from '@/components/ui';
import type { RailGroup, RailStep } from './model';

/**
 * Step rail (DS 7.6): every step grouped by phase, with done / current state and flags. Any step can be opened
 * at any time. `compact` is the 64px icon strip (numbers and status only; titles on hover or focus).
 */
export function StepRail({
  groups,
  currentStepId,
  onSelect,
  compact = false,
  scrollCurrentIntoView = true,
  className,
}: {
  groups: RailGroup[];
  currentStepId: string;
  onSelect: (stepId: string) => void;
  compact?: boolean;
  scrollCurrentIntoView?: boolean;
  className?: string;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!scrollCurrentIntoView) return;
    root.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'center' });
  }, [scrollCurrentIntoView]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const keys = ['Home', 'End', 'ArrowDown', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    const rows = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-rail-row]') ?? []);
    if (rows.length === 0) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
    e.preventDefault();
    rows[next]?.focus();
  };

  return (
    <nav ref={root} aria-label="Steps" onKeyDown={onKeyDown} className={cn('group/rail', className)}>
      {groups.map((g) => (
        <section key={g.phase.id} aria-label={g.phase.title}>
          <h3
            className={cn(
              'type-label sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface-raised px-4 py-2 text-ink-muted',
              compact && 'hidden group-hover/rail:flex group-focus-within/rail:flex',
            )}
          >
            <span className="truncate">{g.phase.title}</span>
            <span>
              {g.doneCount}/{g.steps.length}
            </span>
          </h3>
          <ul>
            {g.steps.map((s) => (
              <li key={s.step.id}>
                <Row s={s} current={s.step.id === currentStepId} compact={compact} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function Row({ s, current, compact, onSelect }: { s: RailStep; current: boolean; compact: boolean; onSelect: (id: string) => void }) {
  const flags = [
    s.irreversible && { icon: 'lock' as const, text: "Can't be undone", cls: 'text-danger-fg' },
    s.lowConfidence && { icon: 'doubleCheck' as const, text: 'Double-check with the original', cls: 'text-unsure-fg' },
    s.missingPart && { icon: 'warn' as const, text: 'Needs a part you marked missing', cls: 'text-warn-fg' },
  ].filter((f): f is { icon: 'lock' | 'doubleCheck' | 'warn'; text: string; cls: string } => !!f);
  return (
    <button
      type="button"
      data-rail-row
      data-step={s.step.id}
      data-done={s.done}
      aria-current={current ? 'step' : undefined}
      aria-label={compact ? `Step ${s.number}: ${s.step.title}${s.done ? ', done' : ''}` : undefined}
      onClick={() => onSelect(s.step.id)}
      className={cn(
        'flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left t-fast',
        current ? 'border-l-[3px] border-accent bg-accent-soft pl-[13px]' : 'border-l-[3px] border-transparent pl-[13px] hover:bg-surface-sunken',
        compact && 'justify-center px-0 pl-0 group-hover/rail:justify-start group-hover/rail:pl-[13px] group-focus-within/rail:justify-start group-focus-within/rail:pl-[13px]',
      )}
    >
      <Marker done={s.done} current={current} />
      <span className="type-tag w-6 shrink-0 text-ink-muted">{s.number}</span>
      <span className={cn('type-body line-clamp-2 min-w-0 flex-1', compact && 'hidden group-hover/rail:block group-focus-within/rail:block')}>
        {!compact && s.done && <span className="sr-only">Done. </span>}
        {s.step.title}
      </span>
      <span className={cn('flex shrink-0 gap-1', compact && 'hidden group-hover/rail:flex group-focus-within/rail:flex')}>
        {flags.map((f) => (
          <span key={f.icon} className={f.cls}>
            <Icon name={f.icon} size={20} />
            <span className="sr-only">{f.text}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

function Marker({ done, current }: { done: boolean; current: boolean }) {
  if (done)
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-solid text-success-on" data-marker="done">
        <Icon name="check" size={16} />
      </span>
    );
  return (
    <span
      data-marker={current ? 'current' : 'todo'}
      className={cn('size-6 shrink-0 rounded-full border-2', current ? 'border-accent bg-accent' : 'border-ink-subtle')}
      style={current ? { boxShadow: 'inset 0 0 0 4px var(--color-accent-soft)' } : undefined}
    />
  );
}
