import { cn } from './cn';
import { Icon } from './Icon';

export type StageMarker = 'pending' | 'active' | 'done' | 'failed';
export type StageRow = { label: string; marker: StageMarker; detail?: string | null };

function Marker({ marker }: { marker: StageMarker }) {
  const base = 'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full';
  if (marker === 'done')
    return (
      <span className={cn(base, 'bg-success-solid text-success-on')}>
        <Icon name="check" size={16} />
      </span>
    );
  if (marker === 'failed')
    return (
      <span className={cn(base, 'bg-danger-solid text-danger-on')}>
        <Icon name="close" size={16} />
      </span>
    );
  if (marker === 'active')
    // Reduced motion: .spinner stops, leaving a static accent arc on its ring.
    return (
      <span className={cn(base, 'relative text-accent')}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="absolute inset-0">
          <circle cx="12" cy="12" r="9" strokeWidth="2" className="stroke-ink-subtle" />
        </svg>
        <Icon name="spinner" size={24} className="spinner absolute inset-0" />
      </span>
    );
  return (
    <span className={cn(base, 'border-2 border-ink-subtle')} />
  );
}

const stateWord: Record<StageMarker, string> = {
  pending: 'waiting',
  active: 'in progress',
  done: 'done',
  failed: 'failed',
};

/** Processing stage list (DS 7.14). Driven only by the job's real state; announced politely. */
export function StageList({ rows, className }: { rows: StageRow[]; className?: string }) {
  return (
    <ol aria-live="polite" aria-label="Progress" className={cn('flex flex-col gap-4', className)}>
      {rows.map((r) => (
        <li key={r.label} data-marker={r.marker} aria-current={r.marker === 'active' ? 'step' : undefined} className="flex gap-3">
          <Marker marker={r.marker} />
          <div className="min-w-0">
            <p className={cn('type-body-lg', r.marker === 'active' && 'font-semibold', r.marker === 'pending' && 'text-ink-muted')}>
              {r.label}
              <span className="sr-only">, {stateWord[r.marker]}</span>
            </p>
            {r.detail && <p className="type-body-sm text-ink-muted">{r.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
