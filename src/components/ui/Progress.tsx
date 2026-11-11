import { cn } from './cn';

/** Fill fraction (0-1) per phase for `completed` finished steps; phases are in order. */
export function segmentFills(phases: ReadonlyArray<{ steps: number }>, completed: number): number[] {
  let remaining = Math.max(0, completed);
  return phases.map((p) => {
    if (p.steps <= 0) return 0;
    const done = Math.min(remaining, p.steps);
    remaining -= done;
    return done / p.steps;
  });
}

export type SegmentedProgressProps = {
  phases: ReadonlyArray<{ steps: number }>;
  /** 1-based current step. */
  current: number;
  total: number;
  /** Current step title, for aria-valuetext. */
  title?: string;
  /** Finished steps; defaults to current - 1. */
  completed?: number;
  className?: string;
};

/** Segmented bar + counter (DS 7.5). The bar alone is never the accessible value. */
export function SegmentedProgress({ phases, current, total, title, completed, className }: SegmentedProgressProps) {
  const fills = segmentFills(phases, completed ?? current - 1);
  const valueText = `Step ${current} of ${total}${title ? `, ${title}` : ''}`;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p className="type-label text-ink-muted">
        Step {current} of {total}
      </p>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-valuetext={valueText}
        className="flex h-1.5 gap-0.5"
      >
        {phases.map((p, i) => {
          const f = fills[i] ?? 0;
          return (
            <div
              key={i}
              data-testid="progress-segment"
              className="h-full overflow-hidden rounded-full bg-line"
              style={{ flexGrow: p.steps, flexBasis: 0 }}
            >
              <div
                className={cn('h-full rounded-full', f >= 1 ? 'bg-success-fg' : 'bg-accent')}
                style={{
                  width: `${f * 100}%`,
                  transition: 'width var(--dur-base) var(--ease-in-out), background-color var(--dur-base) var(--ease-in-out)',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Ring (library card): 28px, 3px stroke, percent of completed steps. */
export function ProgressRing({ percent, label }: { percent: number; label?: string }) {
  const p = Math.min(100, Math.max(0, percent));
  const r = 12.5;
  const c = 2 * Math.PI * r;
  return (
    <svg
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={p}
      aria-label={label ?? `${p}% of steps done`}
      width={28}
      height={28}
      viewBox="0 0 28 28"
      className="shrink-0 -rotate-90"
    >
      <circle cx="14" cy="14" r={r} fill="none" strokeWidth={3} className="stroke-line" />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        strokeWidth={3}
        strokeLinecap="round"
        className={p >= 100 ? 'stroke-success-fg' : 'stroke-accent'}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p / 100)}
        style={{ transition: 'stroke-dashoffset var(--dur-base) var(--ease-in-out)' }}
      />
    </svg>
  );
}
