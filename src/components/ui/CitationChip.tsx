import { cn } from './cn';
import { Icon } from './Icon';

/** A citation is valid when its page is a positive integer. */
export function citationLabel(page: number, stepNumber?: number): { text: string; aria: string } | null {
  if (!Number.isInteger(page) || page < 1) return null;
  const hasStep = stepNumber !== undefined && Number.isInteger(stepNumber) && stepNumber >= 1;
  return {
    text: hasStep ? `Step ${stepNumber} · p. ${page}` : `p. ${page}`,
    aria: `Open manual page ${page}${hasStep ? `, step ${stepNumber}` : ''}`,
  };
}

/**
 * Citation chip (DS 7.11). `page` is the 1-based page number (pageIndex + 1).
 * A citation that fails validation is not rendered at all.
 */
export function CitationChip({
  page,
  stepNumber,
  onOpen,
  className,
}: {
  page: number;
  stepNumber?: number;
  onOpen?: () => void;
  className?: string;
}) {
  const label = citationLabel(page, stepNumber);
  if (!label) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label.aria}
      className={cn(
        'type-tag focus-on-accent relative inline-flex h-7 cursor-pointer items-center gap-1 rounded-xs border border-transparent bg-accent-soft px-2 text-accent t-fast',
        'before:absolute before:inset-x-0 before:-inset-y-2 before:content-[""]',
        'hover:border-accent active:border-accent active:bg-accent active:text-on-accent',
        className,
      )}
    >
      <Icon name="page" size={16} />
      {label.text}
    </button>
  );
}
