import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';
import { ProgressRing } from './Progress';
import { Skeleton } from './Skeleton';

const cardBase = 'block bg-surface border border-line rounded-md p-4 lg:p-5 text-ink';

/** Static card: surface, elev-0 (1px line border), radius md, padding 16 (20 on lg). */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(cardBase, className)} {...rest} />;
}

/** Interactive card: the whole card is one link (DS 7.2). Secondary actions live outside it. */
export function LinkCard({
  href,
  className,
  children,
  ...rest
}: { href: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <a
      href={href}
      className={cn(cardBase, 't-fast no-underline hover:border-ink-subtle active:bg-surface-sunken', className)}
      {...rest}
    >
      {children}
    </a>
  );
}

export type GuideCardStatus = 'ready' | 'inProgress' | 'finished' | 'processing' | 'failed';

/** Library card in its five states (DS 7.2). */
export function GuideCard({
  title,
  status,
  href = '#',
  step,
  totalSteps,
  stageText = 'Reading pages',
}: {
  title: string;
  status: GuideCardStatus;
  href?: string;
  step?: number;
  totalSteps?: number;
  stageText?: string;
}) {
  const percent = step && totalSteps ? Math.round(((step - 1) / totalSteps) * 100) : 0;
  return (
    <LinkCard href={href} className="flex items-center gap-4 min-h-24">
      {status === 'processing' ? (
        <Skeleton className="size-16 rounded-sm" />
      ) : (
        <div className="size-16 shrink-0 rounded-sm bg-surface-sunken border border-line" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <h3 className="type-display-md line-clamp-2">{title}</h3>
        <p className="type-body-sm text-ink-muted mt-1 flex items-center gap-2">
          {status === 'ready' && 'Ready'}
          {status === 'inProgress' && (
            <>
              <ProgressRing percent={percent} />
              <span>
                Step {step} of {totalSteps}
              </span>
            </>
          )}
          {status === 'finished' && (
            <span className="inline-flex items-center gap-1 text-success-fg">
              <Icon name="checkCircle" size={20} /> Finished
            </span>
          )}
          {status === 'processing' && stageText}
          {status === 'failed' && (
            <span className="inline-flex items-center gap-1 text-danger-fg">
              <Icon name="crossCircle" size={20} /> Couldn&apos;t finish - Try again
            </span>
          )}
        </p>
      </div>
    </LinkCard>
  );
}
