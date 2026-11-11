import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { PageTag, ProvenanceTag, SourceQuote } from './SourceQuote';

export type BannerKind = 'caution' | 'warning' | 'irreversible' | 'error' | 'info' | 'unsure';

const IRREVERSIBLE_TEXT = 'Check the picture and the parts before you do this step.';
const UNSURE_TEXT = "We're less sure we read this step correctly. Compare it with the original page.";
const INFO_TEXT = 'The original manual is the authority. If this guide and the manual differ, follow the manual.';

const cfg: Record<
  BannerKind,
  { icon: IconName | null; label: string | null; box: string; fg: string; text?: string }
> = {
  caution: { icon: 'warn', label: 'Caution', box: 'bg-warn-soft border-l-4 border-warn-fg', fg: 'text-warn-fg' },
  warning: { icon: 'warn', label: 'Warning', box: 'bg-warn-soft border-[1.5px] border-warn-fg border-l-4', fg: 'text-warn-fg' },
  irreversible: {
    icon: 'lock',
    label: "Can't be undone",
    box: 'bg-danger-soft border-2 border-danger-fg',
    fg: 'text-danger-fg',
    text: IRREVERSIBLE_TEXT,
  },
  error: { icon: 'warn', label: 'Error', box: 'bg-danger-soft border-l-4 border-danger-fg', fg: 'text-danger-fg' },
  info: { icon: 'info', label: null, box: 'bg-surface-sunken border border-line', fg: 'text-ink-muted', text: INFO_TEXT },
  unsure: {
    icon: 'doubleCheck',
    label: 'Double-check',
    box: 'bg-unsure-soft border-[1.5px] border-dashed border-unsure-fg',
    fg: 'text-unsure-fg',
    text: UNSURE_TEXT,
  },
};

export type BannerProps = {
  kind: BannerKind;
  /** Overrides the default label (errors name the problem). */
  label?: string;
  /** Overrides default text. Never truncated or collapsed. */
  children?: ReactNode;
  /** Source line / quote / provenance below the text. */
  source?: ReactNode;
  /** Trailing action (Quiet or Primary button) or citation chip. */
  action?: ReactNode;
  /** Set for banners that appear in response to an action: role="alert" instead of "note". */
  live?: boolean;
  className?: string;
};

/** Banners (DS 7.12): static `role="note"` content by default. */
export function Banner({ kind, label, children, source, action, live, className }: BannerProps) {
  const c = cfg[kind];
  const body = children ?? c.text;
  const text = label ?? c.label;
  return (
    <div
      role={live ? 'alert' : 'note'}
      data-kind={kind}
      className={cn('relative overflow-hidden rounded-md px-4 py-3 text-ink', c.box, kind === 'irreversible' && 'pt-5', className)}
    >
      {kind === 'irreversible' && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-2"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, var(--color-danger-fg) 0 4px, var(--color-danger-soft) 4px 8px)',
          }}
        />
      )}
      <div className="flex gap-3">
        {c.icon && <Icon name={c.icon} className={c.fg} />}
        <div className="min-w-0 flex-1">
          {text && <p className={cn('type-label', c.fg)}>{text}</p>}
          {body && (
            <div className={cn(kind === 'info' ? 'type-body' : 'type-body-lg', kind === 'warning' && 'font-semibold')}>
              {body}
            </div>
          )}
          {source && <div className="mt-2">{source}</div>}
          {action && <div className="mt-2 flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      </div>
    </div>
  );
}

/** Whitespace-normalised comparison used to choose the warning's source line (DS 7.12). */
export function normaliseQuote(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

export type WarningSourceCase = 'same' | 'different' | 'none';

export function warningSourceCase(text: string, sourceQuote?: string | null): WarningSourceCase {
  if (!sourceQuote || !sourceQuote.trim()) return 'none';
  return normaliseQuote(text) === normaliseQuote(sourceQuote) ? 'same' : 'different';
}

/**
 * Warning banner wired to the three source-line cases of DS 7.12. Warning text is the data's wording,
 * shown in full; unrecognised severities render as warning.
 */
export function WarningBanner({
  severity,
  text,
  sourceQuote,
  page,
  lang,
  onOpenPage,
  className,
}: {
  severity: string;
  text: string;
  sourceQuote?: string | null;
  /** 1-based page of the warning's source. */
  page: number;
  lang?: string;
  onOpenPage?: () => void;
  className?: string;
}) {
  const kind: BannerKind = severity === 'caution' ? 'caution' : 'warning';
  const which = warningSourceCase(text, sourceQuote);
  const source =
    which === 'same' ? (
      <p className="type-body-sm flex items-center gap-1 text-ink-muted">
        From your manual <PageTag page={page} onOpen={onOpenPage} />
      </p>
    ) : which === 'different' ? (
      <SourceQuote quote={sourceQuote} page={page} lang={lang} onOpenPage={onOpenPage} />
    ) : (
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceTag kind="diagramShort" />
        <PageTag page={page} onOpen={onOpenPage} />
      </div>
    );
  return (
    <Banner kind={kind} source={source} className={className}>
      {text}
    </Banner>
  );
}
