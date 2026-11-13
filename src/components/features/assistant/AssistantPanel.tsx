'use client';

import { useEffect, useRef } from 'react';
import { Button, Chip, Icon, Skeleton, SkeletonRegion } from '@/components/ui';
import { conversationItems, type Assistant, type Citation } from '@/lib/client/assistant';
import { getOwn } from '@/lib/guide/selectors';
import type { ValidatedGuide } from '@/lib/guide/validate';
import { stepPosition } from '../player/model';
import { PartThumb } from '../overview/part-thumb';
import { Composer } from './Composer';
import { COPY } from './copy';
import { AssistantAnswer, StepDivider, TurnView, UserBubble, type CitationEnv } from './Messages';

export interface AssistantViewProps {
  guide: ValidatedGuide;
  documentId: string;
  pageCount: number;
  /** The step the player is showing; new questions are about this step. */
  stepId: string;
  assistant: Assistant;
  online: boolean;
  /** The question being typed. Held by the player so it survives the dock and the sheet swapping places. */
  draft: string;
  onDraftChange: (text: string) => void;
  onGoToStep: (stepId: string) => void;
  onOpenCitation: (c: Citation) => void;
  onOpenManual: () => void;
}

/** What the assistant is looking at (USER_FLOWS 7 context strip). Tapping it (sheet only) closes the sheet. */
export function ContextStrip({ guide, documentId, stepId, onTap }: { guide: ValidatedGuide; documentId: string; stepId: string; onTap?: () => void }) {
  const step = getOwn(guide.steps, stepId);
  if (!step) return null;
  const { number } = stepPosition(guide, stepId);
  // The sheet covers the step's banners, so the strip says they exist (irreversible wins).
  const warnings = step.warnings.length;
  const safety = step.irreversible
    ? { text: "Can't be undone", icon: 'lock' as const, cls: 'bg-danger-soft text-danger-fg' }
    : warnings > 0
      ? { text: `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`, icon: 'warn' as const, cls: 'bg-warn-soft text-warn-fg' }
      : null;
  const body = (
    <>
      <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xs bg-surface-sunken text-ink-subtle">
        <Icon name="page" size={24} />
        <span className="absolute inset-0">
          <PartThumb documentId={documentId} source={step.sources[0]} size={48} />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="type-label block text-ink-muted" data-testid="context-label">
          STEP {number}
        </span>
        <span className="type-body block truncate font-semibold text-ink" data-testid="context-title">
          {step.title}
        </span>
      </span>
      {safety && (
        <span className={`type-tag inline-flex shrink-0 items-center gap-1 rounded-xs px-2 py-0.5 ${safety.cls}`} data-testid="context-safety">
          <Icon name={safety.icon} size={16} />
          {safety.text}
        </span>
      )}
    </>
  );
  const cls = 'flex h-16 w-full items-center gap-3 border-b border-line px-4 text-left';
  return onTap ? (
    <button type="button" onClick={onTap} className={`${cls} cursor-pointer t-fast hover:bg-surface-sunken`} data-testid="context-strip" aria-label={`Step ${number}: ${step.title}.${safety ? ` ${safety.text}.` : ''} Close and go back to the step`}>
      {body}
    </button>
  ) : (
    <div className={cls} data-testid="context-strip">
      {body}
    </div>
  );
}

function HistorySkeleton() {
  return (
    <SkeletonRegion>
      <div className="flex flex-col gap-4" data-testid="history-skeleton">
        <Skeleton className="ml-auto h-10 w-2/3" />
        <div className="flex flex-col gap-2 border-l-[3px] border-line pl-3">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** Conversation, suggestions and composer. Shared by the bottom sheet and the desktop dock. */
export function AssistantPanel(p: AssistantViewProps & { onClear: () => void; onStripTap?: () => void; showStrip?: boolean }) {
  const { assistant: a, guide } = p;
  const { state } = a;
  const items = conversationItems(state);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const env: CitationEnv = {
    currentStepId: p.stepId,
    stepNumber: (id) => (getOwn(guide.steps, id) ? stepPosition(guide, id).number : undefined),
    pageExists: (i) => i < Math.max(1, p.pageCount),
    onGoToStep: p.onGoToStep,
    onOpenCitation: p.onOpenCitation,
  };

  // Newest at the bottom; follow the stream unless the reader has scrolled up.
  const answerLength = state.turn?.answer.length ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items.length, answerLength, state.history]);

  const hasMessages = state.messages.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="assistant-panel">
      {p.showStrip !== false && <ContextStrip guide={guide} documentId={p.documentId} stepId={p.stepId} onTap={p.onStripTap} />}

      <div
        ref={scroller}
        role="region"
        aria-label="Conversation"
        tabIndex={0}
        data-testid="conversation"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${p.showStrip === false ? 'min-h-[120px] p-4' : 'px-4 py-3'}`}
      >
        <div className="flex flex-col gap-4">
          {hasMessages && !a.busy && (
            <div className="-mb-2 flex justify-end">
              <Button variant="quiet" size="sm" onClick={p.onClear} data-testid="clear-conversation">
                {COPY.clear}
              </Button>
            </div>
          )}
          {state.history === 'loading' && <HistorySkeleton />}
          {state.history === 'error' && (
            <div className="flex flex-col items-start gap-1" data-testid="history-error">
              <p className="type-body text-ink-muted">{COPY.historyFailed}</p>
              <Button variant="quiet" size="sm" className="-ml-3" onClick={a.reloadHistory}>
                {COPY.tryAgain}
              </Button>
            </div>
          )}
          {state.history === 'ready' && items.length === 0 && (
            <p className="type-body-lg text-ink-muted" data-testid="assistant-empty">
              {COPY.empty}
            </p>
          )}
          {items.map((it, i) => {
            if (it.kind === 'divider') return <StepDivider key={`d-${i}`} number={env.stepNumber(it.stepId)} />;
            if (it.kind === 'turn') return <TurnView key={`t-${it.turn.localId}`} turn={it.turn} onRetry={a.retry} />;
            return it.message.role === 'user' ? (
              <UserBubble key={it.message.id} text={it.message.text} />
            ) : (
              <AssistantAnswer key={it.message.id} message={it.message} env={env} onOpenManual={p.onOpenManual} />
            );
          })}
        </div>
      </div>

      {/* One polite announcement when an answer is complete; never per token. */}
      <div role="status" aria-live="polite" className="sr-only" data-testid="assistant-live">
        {state.announce}
      </div>

      <div className={`shrink-0 border-t border-line ${p.showStrip === false ? 'bg-surface px-4 pb-4 pt-3' : 'bg-surface-raised px-4 pb-2 pt-2'}`}>
        {a.suggestions.length > 0 && !a.busy && (
          <ul className="-mt-1 mb-1 flex flex-wrap gap-x-2" aria-label="Suggested questions" data-testid="suggestions">
            {a.suggestions.map((s) => (
              <li key={s}>
                <Chip aria-pressed={undefined} disabled={!p.online} onClick={() => a.send(s)}>
                  {s}
                </Chip>
              </li>
            ))}
          </ul>
        )}
        <Composer
          value={p.draft}
          onValueChange={p.onDraftChange}
          label={`Ask a question about step ${stepPosition(guide, p.stepId).number}`}
          busy={a.busy}
          disabledReason={p.online ? undefined : COPY.offline} onSend={a.send} onStop={a.stop}
        />
      </div>
    </div>
  );
}
