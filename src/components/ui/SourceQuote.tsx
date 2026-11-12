import { cn } from './cn';
import { Icon } from './Icon';

const collapse = (s: string) => s.trim().replace(/\s+/g, ' ');

/** True when the quote is the same words as `text` after trimming and collapsing whitespace (DS 7.16). Nothing fuzzier. */
export const quoteEqualsText = (text: string, quote: string | null | undefined): boolean =>
  !!quote && !!quote.trim() && collapse(text) === collapse(quote);

/** One muted "From your manual" line with the page tag, used when the text above it is the manual's sentence. */
export function SourceLine({ page, onOpenPage, className }: { page: number; onOpenPage?: () => void; className?: string }) {
  return (
    <p className={cn('type-body-sm flex items-center gap-1 text-ink-muted', className)} data-testid="source-line">
      From your manual <PageTag page={page} onOpen={onOpenPage} />
    </p>
  );
}

/**
 * The provenance slot under Instructor text: a short source line when the manual's quote is the same words
 * (never the same words twice), the full Source quote when it differs, nothing when there is no quote.
 */
export function QuoteOrLine({
  text,
  quote,
  page,
  lang,
  onOpenPage,
  className,
}: {
  text: string;
  quote: string | null | undefined;
  page: number;
  lang?: string;
  onOpenPage?: () => void;
  className?: string;
}) {
  if (!quote) return null;
  return quoteEqualsText(text, quote) ? (
    <SourceLine page={page} onOpenPage={onOpenPage} className={className} />
  ) : (
    <SourceQuote quote={quote} page={page} lang={lang} onOpenPage={onOpenPage} className={className} />
  );
}

/** "p. 12" page tag. `page` is the 1-based page number. */
export function PageTag({ page, onOpen, className }: { page: number; onOpen?: () => void; className?: string }) {
  const text = `p. ${page}`;
  if (!onOpen) return <span className={cn('type-tag text-ink-muted', className)}>{text}</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open manual page ${page}`}
      className={cn(
        'type-tag inline-flex min-h-12 min-w-11 cursor-pointer items-center justify-center rounded-xs px-2 text-accent underline t-fast hover:bg-accent-soft',
        className,
      )}
    >
      {text}
    </button>
  );
}

/**
 * The manual's exact words (DS 7.16). Verbatim: no trimming, case change, translation or added quote marks,
 * never truncated. Rendered only when a quote exists - the UI never builds one from other fields.
 */
export function SourceQuote({
  quote,
  page,
  lang,
  onOpenPage,
  className,
}: {
  quote: string | null | undefined;
  /** 1-based page number of the quote's source. */
  page: number;
  /** The manual's language (BCP 47). */
  lang?: string;
  onOpenPage?: () => void;
  className?: string;
}) {
  if (!quote) return null;
  return (
    <blockquote className={cn('min-w-0 max-w-full border-l-[3px] border-ink pl-3', className)}>
      <div className="flex items-center gap-2">
        <span className="type-label text-ink">From your manual</span>
        <PageTag page={page} onOpen={onOpenPage} />
      </div>
      <p lang={lang} className="type-body whitespace-pre-wrap wrap-anywhere text-ink">
        {quote}
      </p>
    </blockquote>
  );
}

export type ProvenanceKind = 'diagram' | 'diagramShort' | 'approximate' | 'doubleCheck';

const tags: Record<ProvenanceKind, { icon: 'eye' | 'dashedSquare' | 'doubleCheck'; text: string; dashed?: boolean }> = {
  diagram: { icon: 'eye', text: 'Read from the picture - the manual has no words here' },
  diagramShort: { icon: 'eye', text: 'Read from the picture' },
  approximate: { icon: 'dashedSquare', text: 'Approximate area', dashed: true },
  doubleCheck: { icon: 'doubleCheck', text: 'Double-check with the original', dashed: true },
};

/** One-line `unsure`-family tag for Instructor's interpretation (DS 7.12, 7.16). */
export function ProvenanceTag({ kind, className }: { kind: ProvenanceKind; className?: string }) {
  const t = tags[kind];
  return (
    <span
      className={cn(
        'type-body-sm inline-flex items-center gap-2 rounded-sm border bg-unsure-soft px-2 py-1 font-semibold text-unsure-fg',
        t.dashed ? 'border-dashed border-unsure-fg' : 'border-solid border-unsure-fg',
        className,
      )}
    >
      <Icon name={t.icon} size={20} />
      {t.text}
    </span>
  );
}

/** First line of "Why" / "Common mistake" disclosures (DS 7.16). */
export function InstructorNote({ className }: { className?: string }) {
  return <p className={cn('type-body-sm text-ink-muted', className)}>Instructor&apos;s explanation - not the manual&apos;s wording.</p>;
}
