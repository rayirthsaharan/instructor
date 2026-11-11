'use client';

import Link from 'next/link';
import { Banner, Button, buttonClass, cn, Icon, Menu, type MenuItem } from '@/components/ui';
import { segmentFills } from '@/components/ui/Progress';
import { ExtraIcon } from '../source-visual/icons';
import type { PrimaryKind, RailGroup, StepPosition } from './model';
import type { PlayerLayout } from './hooks';

/** Segmented progress (DS 7.5) from real per-phase completion; the bar is never the accessible value on its own. */
export function PlayerProgress({
  groups,
  position,
  title,
  irreversible,
  className,
}: {
  groups: RailGroup[];
  position: StepPosition;
  title: string;
  irreversible: boolean;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={position.total}
      aria-valuenow={position.number}
      aria-valuetext={`Step ${position.number} of ${position.total}, ${title}`}
      data-testid="player-progress"
      className={cn('flex h-1.5 gap-0.5 px-4 md:px-6', irreversible && 'border-b-2 border-danger-fg box-content', className)}
    >
      {groups.map((g) => {
        const f = segmentFills([{ steps: g.steps.length }], g.doneCount)[0] ?? 0;
        return (
          <div key={g.phase.id} data-testid="progress-segment" className="h-full overflow-hidden rounded-full bg-line" style={{ flexGrow: g.steps.length, flexBasis: 0 }}>
            <div
              className={cn('h-full rounded-full', f >= 1 ? 'bg-success-fg' : 'bg-accent')}
              style={{ width: `${f * 100}%`, transition: 'width var(--dur-base) var(--ease-in-out), background-color var(--dur-base) var(--ease-in-out)' }}
            />
          </div>
        );
      })}
    </div>
  );
}

export function CloseLink({ href, overlay }: { href: string; overlay?: boolean }) {
  return (
    <Link
      href={href}
      aria-label="Leave guide"
      data-testid="leave-guide"
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-ink t-fast hover:bg-surface-sunken',
        overlay && 'bg-surface/92 shadow-elev-1',
      )}
    >
      <Icon name="close" />
    </Link>
  );
}

/** "STEP 7 OF 24 · FRAME" (phase drops first when space is short). Below 360px it is the Steps button. */
export function StepCounter({
  position,
  review,
  onOpenSteps,
  asButton = false,
}: {
  position: StepPosition;
  review: boolean;
  onOpenSteps?: () => void;
  /** Always show the counter as the Steps button (phone landscape), not only below 360px. */
  asButton?: boolean;
}) {
  const text = (
    <>
      <span className="whitespace-nowrap">
        Step {position.number} of {position.total}
      </span>
      {position.phase && <span className="ml-1.5 truncate">· {position.phase.title}</span>}
    </>
  );
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {onOpenSteps ? (
        <>
          <p className={cn('type-label flex min-w-0 text-ink-muted max-[359px]:hidden', asButton && '!hidden')} data-testid="step-counter">
            {text}
          </p>
          <button
            type="button"
            onClick={onOpenSteps}
            aria-label={`Step ${position.number} of ${position.total}. Open the list of steps`}
            data-testid="counter-steps"
            className={cn('type-label hidden min-h-11 min-w-0 cursor-pointer items-center gap-1 text-ink-muted max-[359px]:flex', asButton && '!flex')}
          >
            Step {position.number} of {position.total}
            <ExtraIcon name="list" size={20} />
          </button>
        </>
      ) : (
        <p className="type-label flex min-w-0 text-ink-muted" data-testid="step-counter">
          {text}
        </p>
      )}
      {review && (
        <span className="type-tag rounded-xs bg-success-soft px-2 py-1 text-success-fg" data-testid="finished-tag">
          Finished
        </span>
      )}
    </div>
  );
}

export function OverflowMenu({ items }: { items: MenuItem[] }) {
  return <Menu label="More options for this guide" items={items} width={288} />;
}

/** Read-aloud toggle with the speaker glyph (the shared icon set has none). */
export function SpeakerButton({ speaking, onToggle }: { speaking: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={speaking ? 'Stop reading aloud' : 'Read this step aloud'}
      aria-pressed={speaking}
      onClick={onToggle}
      data-testid="read-aloud"
      className={cn(
        'inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm t-fast hover:bg-surface-sunken',
        speaking ? 'bg-accent-soft text-accent' : 'text-ink',
      )}
    >
      <ExtraIcon name="speaker" />
    </button>
  );
}

export interface ActionBarProps {
  layout: PlayerLayout;
  canGoBack: boolean;
  primary: { kind: PrimaryKind; label: string };
  /** The step being shown cannot be undone (border turns danger). */
  irreversible: boolean;
  /** The next step cannot be undone (one-line notice above the bar). */
  nextIrreversible: boolean;
  onBack: () => void;
  onPrimary: () => void;
  onSteps: () => void;
  onAsk: () => void;
  coach?: { onDismiss: () => void } | null;
}

/** Back / Primary / Steps / Ask, all 56 high (DS 4). Only the Primary completes a step. */
export function ActionBar(p: ActionBarProps) {
  const labelled = p.layout === 'tablet' || p.layout === 'desktop';
  const showSteps = p.layout !== 'desktop' && p.layout !== 'landscape';
  const square = 'size-14 shrink-0 !px-0';
  const wide = 'h-14 shrink-0 !px-3';
  const irreversiblePrimary = p.primary.kind === 'irreversible';
  return (
    <div
      data-testid="action-bar"
      className={cn(
        'shrink-0 bg-surface shadow-elev-1',
        p.irreversible ? 'border-t-2 border-danger-fg' : 'border-t border-line',
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {p.nextIrreversible && (
        <p className="type-body-sm flex items-center gap-2 px-3 pt-2 font-semibold text-danger-fg" data-testid="next-irreversible">
          <Icon name="lock" size={20} /> Next step can&apos;t be undone
        </p>
      )}
      {p.coach && (
        <div className="type-body-sm flex items-center gap-2 px-3 pt-2 text-ink-muted" data-testid="coach">
          <p className="flex-1">Swipe or use the arrows to look around. Tap Done when you&apos;ve finished a step.</p>
          <Button variant="quiet" size="sm" onClick={p.coach.onDismiss}>
            Got it
          </Button>
        </div>
      )}
      <div className={cn('mx-auto flex items-center gap-2 p-3', labelled && 'max-w-[640px]')}>
        <button
          type="button"
          onClick={p.onBack}
          disabled={!p.canGoBack}
          aria-label={labelled ? undefined : 'Previous step'}
          data-testid="back"
          className={buttonClass('secondary', 'lg', labelled ? wide : square)}
        >
          <ExtraIcon name="arrowLeft" />
          {labelled && <span>Back</span>}
        </button>
        <Button
          size="lg"
          variant={irreversiblePrimary ? 'secondary' : 'primary'}
          leadingIcon={irreversiblePrimary ? 'lock' : undefined}
          onClick={p.onPrimary}
          data-testid="primary"
          className={cn('min-w-[132px] flex-1 !px-2', irreversiblePrimary && '!border-danger-fg !text-danger-fg')}
        >
          {p.primary.label}
        </Button>
        {showSteps && (
          <button
            type="button"
            onClick={p.onSteps}
            aria-label={labelled ? undefined : 'Steps'}
            data-testid="steps-button"
            className={cn(buttonClass('secondary', 'lg', labelled ? wide : square), 'max-[359px]:hidden')}
          >
            <ExtraIcon name="list" />
            {labelled && <span>Steps</span>}
          </button>
        )}
        <button
          type="button"
          onClick={p.onAsk}
          aria-label={labelled ? undefined : 'Ask'}
          data-testid="ask-button"
          className={cn(buttonClass('quiet', 'lg', labelled ? wide : square), 'bg-accent-soft')}
        >
          <ExtraIcon name="message" />
          {labelled && <span>Ask</span>}
        </button>
      </div>
    </div>
  );
}

export function OfflineBanner() {
  return (
    <Banner kind="info" className="rounded-none">
      You&apos;re offline. Steps you&apos;ve opened still work; asking questions needs a connection.
    </Banner>
  );
}
