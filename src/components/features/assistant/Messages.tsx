'use client';

import { Button, cn, Icon } from '@/components/ui';
import type { ChatMessage, Citation, Turn } from '@/lib/client/assistant';
import { COPY, errorView } from './copy';

/** Everything the conversation needs to turn a citation into chips; the panel supplies it. */
export interface CitationEnv {
  /** 1-based step number, or undefined when the id is not a step of this guide. */
  stepNumber: (stepId: string) => number | undefined;
  /** True when the page exists in the manual. */
  pageExists: (pageIndex: number) => boolean;
  onGoToStep: (stepId: string) => void;
  onOpenCitation: (c: Citation) => void;
}

const chipClass = cn(
  'type-tag focus-on-accent relative inline-flex h-7 cursor-pointer items-center gap-1 rounded-xs border border-transparent bg-accent-soft px-2 text-accent t-fast',
  'before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[""]',
  'hover:border-accent active:border-accent active:bg-accent active:text-on-accent',
);

function CitationChips({ citations, env }: { citations: Citation[]; env: CitationEnv }) {
  const usable = citations.filter((c) => env.pageExists(c.pageIndex));
  if (usable.length === 0) return null;
  return (
    <div role="group" aria-label="Where this is in your manual" className="mt-2 flex flex-wrap gap-x-2 gap-y-3" data-testid="citations">
      {usable.map((c, i) => {
        const n = c.stepId ? env.stepNumber(c.stepId) : undefined;
        return (
          <span key={`${c.stepId ?? ''}-${c.pageIndex}-${i}`} className="inline-flex gap-1">
            {c.stepId && n !== undefined && (
              <button type="button" className={chipClass} aria-label={`Go to step ${n}`} data-testid="cite-step" onClick={() => env.onGoToStep(c.stepId!)}>
                Step {n}
              </button>
            )}
            <button
              type="button"
              className={chipClass}
              aria-label={`Open manual page ${c.pageIndex + 1}${n !== undefined ? `, step ${n}` : ''}`}
              data-testid="cite-page"
              onClick={() => env.onOpenCitation(c)}
            >
              <Icon name="page" size={16} />p. {c.pageIndex + 1}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function DashedCircle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false" className="shrink-0">
      <circle cx="12" cy="12" r="9" strokeDasharray="3.5 3" />
    </svg>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end" data-testid="user-message">
      <p className="type-body-lg max-w-[85%] whitespace-pre-wrap wrap-anywhere rounded-md rounded-br-[4px] bg-accent-soft px-3 py-2 text-ink">{text}</p>
    </div>
  );
}

/**
 * Assistant answer. Always plain text (`{text}` is escaped by React; line breaks kept by CSS). Labelled as Instructor's
 * own explanation (D-011), never styled like the manual's Source quote.
 */
export function AssistantAnswer({ message, env, onOpenManual }: { message: ChatMessage; env: CitationEnv; onOpenManual: () => void }) {
  if (message.notInManual) {
    return (
      <div className="rounded-md bg-unsure-soft px-3 py-3" data-testid="assistant-message" data-kind="not-in-manual">
        <p className="type-label flex items-center gap-2 text-unsure-fg">
          <DashedCircle />
          {COPY.notInManualLabel}
        </p>
        <p className="type-body-lg mt-1 whitespace-pre-wrap wrap-anywhere text-ink">{message.text}</p>
        <Button variant="quiet" size="sm" className="-ml-3 mt-1" onClick={onOpenManual} data-testid="open-manual">
          {COPY.openManual}
        </Button>
      </div>
    );
  }
  return (
    <div className="border-l-[3px] border-accent pl-3" data-testid="assistant-message" data-kind="answer">
      <p className="type-body-sm text-ink-muted">{COPY.instructorNote}</p>
      <p className="type-body-lg mt-1 whitespace-pre-wrap wrap-anywhere text-ink">{message.text}</p>
      <CitationChips citations={message.citations} env={env} />
    </div>
  );
}

/** The question in flight (or failed) and the answer so far. */
export function TurnView({ turn, onRetry }: { turn: Turn; onRetry: () => void }) {
  const view = turn.error ? errorView(turn.error.code) : null;
  return (
    <>
      <UserBubble text={turn.question} />
      {turn.status === 'streaming' && (
        <div className="border-l-[3px] border-accent pl-3" data-testid="assistant-streaming" aria-busy="true">
          <p className="type-body-sm text-ink-muted">{COPY.instructorNote}</p>
          <p className="type-body-lg mt-1 whitespace-pre-wrap wrap-anywhere text-ink">
            {turn.answer}
            <span aria-hidden="true" data-testid="caret" className="ml-0.5 inline-block h-[1.1em] w-0.5 translate-y-[0.2em] bg-accent" />
          </p>
          {turn.answer === '' && <span className="sr-only">Looking in your manual</span>}
        </div>
      )}
      {turn.status === 'failed' && view && (
        <div data-testid="turn-error" data-code={turn.error?.code} className={cn(view.kind === 'inline' && 'pl-1')}>
          {view.kind === 'inline' ? (
            <p className={cn('type-body-lg', turn.error?.code === 'stopped' ? 'text-ink-muted' : 'text-danger-fg')} role={turn.error?.code === 'stopped' ? undefined : 'alert'}>
              {view.text}
            </p>
          ) : (
            <div role="alert" className="type-body rounded-md border border-line bg-surface-sunken px-4 py-3 text-ink">
              <div className="flex gap-3">
                <Icon name="info" className="text-ink-muted" />
                <p className="min-w-0 flex-1">{view.text}</p>
              </div>
            </div>
          )}
          {view.kind !== 'limit' && (
            <Button variant="quiet" size="sm" className="-ml-3" onClick={onRetry} data-testid="turn-retry">
              {turn.error?.code === 'stopped' ? COPY.askAgain : COPY.tryAgain}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

export function StepDivider({ number }: { number: number | undefined }) {
  return (
    <div className="flex items-center gap-3 pt-2" data-testid="step-divider">
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <p className="type-label text-ink-muted">{number !== undefined ? `ABOUT STEP ${number}` : 'ABOUT ANOTHER STEP'}</p>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  );
}
