'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/components/ui';
import { COUNTER_FROM, MAX_QUESTION_CHARS } from '@/lib/client/assistant';
import { COPY } from './copy';

function SendIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 19V5m-6 6 6-6 6 6" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function subscribeCoarse(cb: () => void) {
  const mq = matchMedia('(pointer: coarse)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/** Composer (DS 7.13): multiline, 16px text (no iOS zoom), up to 4 lines, Send 48 / Stop while streaming. */
export function Composer({
  busy,
  disabledReason,
  onSend,
  onStop,
  className,
}: {
  busy: boolean;
  /** Offline: composer disabled with this helper. */
  disabledReason?: string;
  onSend: (text: string) => void;
  onStop: () => void;
  className?: string;
}) {
  const [text, setText] = useState('');
  // On touch screens Enter is a new line, so the keyboard key says so (USER_FLOWS 7).
  const coarse = useSyncExternalStore(subscribeCoarse, () => matchMedia('(pointer: coarse)').matches, () => false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const helperId = useId();
  const countId = useId();
  const len = text.length;
  const over = len > MAX_QUESTION_CHARS;
  const blocked = !!disabledReason;
  const canSend = !busy && !blocked && text.trim().length > 0 && !over;

  // Grow with the text up to 4 lines (the CSS max-height), then scroll inside.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // After an answer finishes, give the keyboard back to the field if the Stop control had focus (or focus was lost).
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const a = document.activeElement;
      if ((a === document.body || a === stopRef.current || a === null) && !matchMedia('(pointer: coarse)').matches) ref.current?.focus();
    }
    wasBusy.current = busy;
  }, [busy]);

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <form
      className={cn('flex flex-col gap-1', className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          disabled={busy || blocked}
          aria-label="Your question"
          aria-describedby={cn(disabledReason && helperId, len >= COUNTER_FROM && countId) || undefined}
          aria-invalid={over || undefined}
          placeholder={COPY.placeholder}
          enterKeyHint={coarse ? 'enter' : 'send'}
          data-testid="composer-input"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends on devices with a keyboard; on touch screens Enter is a new line and Send is the button.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !matchMedia('(pointer: coarse)').matches) {
              e.preventDefault();
              submit();
            }
          }}
          className={cn(
            'min-h-12 max-h-[7.5rem] min-w-0 flex-1 resize-none rounded-sm border-[1.5px] bg-surface px-3 py-[0.65rem] text-base leading-6 text-ink placeholder:text-ink-subtle',
            'focus:border-accent disabled:bg-surface-sunken disabled:text-ink-subtle',
            over ? 'border-danger-fg' : 'border-ink-subtle',
          )}
        />
        {busy ? (
          <button
            ref={stopRef}
            type="button"
            onClick={onStop}
            aria-label={COPY.stop}
            data-testid="composer-stop"
            className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-sm border-[1.5px] border-ink-subtle bg-surface text-ink t-fast hover:bg-surface-sunken active:border-ink"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label={COPY.send}
            data-testid="composer-send"
            className="focus-on-accent inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-sm bg-accent text-on-accent t-fast hover:bg-accent-hover active:bg-accent-pressed disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle"
          >
            <SendIcon />
          </button>
        )}
      </div>
      {len >= COUNTER_FROM && (
        <p id={countId} data-testid="composer-count" className={cn('type-body-sm text-right', over ? 'font-semibold text-danger-fg' : 'text-ink-muted')}>
          {over ? `${len - MAX_QUESTION_CHARS} over the limit - ` : ''}
          {len} / {MAX_QUESTION_CHARS}
        </p>
      )}
      {disabledReason && (
        <p id={helperId} className="type-body-sm text-ink-muted" data-testid="composer-helper">
          {disabledReason}
        </p>
      )}
      <p className="type-body-sm text-ink-muted">{COPY.footnote}</p>
    </form>
  );
}
