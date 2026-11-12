import { createElement as h } from 'react';
import { renderToStaticMarkup as html } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantAnswer, StepDivider, TurnView, UserBubble, type CitationEnv } from '@/components/features/assistant/Messages';
import { Composer } from '@/components/features/assistant/Composer';
import { COPY } from '@/components/features/assistant/copy';
import type { ChatMessage } from '@/lib/client/assistant';

const env: CitationEnv = {
  stepNumber: (id) => (id === 's4' ? 4 : undefined),
  pageExists: (i) => i < 6,
  onGoToStep: () => {},
  onOpenCitation: () => {},
};
const noop = () => {};
const esc = (t: string) => t.replace(/'/g, '&#x27;');
const m = (over: Partial<ChatMessage> = {}): ChatMessage => ({ id: 'a', role: 'assistant', text: 'ok', stepId: 's4', createdAt: 1, citations: [], notInManual: false, ...over });

describe('assistant messages render as plain text', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(1)</script> **b** [l](javascript:alert(1))';
  it('escapes markup in answers and questions, and keeps line breaks via CSS', () => {
    const a = html(h(AssistantAnswer, { message: m({ text: `${evil}\nsecond line` }), env, onOpenManual: noop }));
    expect(a).not.toContain('<img');
    expect(a).not.toContain('<script');
    expect(a).toContain('&lt;img');
    expect(a).toContain('whitespace-pre-wrap');
    expect(a).toContain('**b**');
    const u = html(h(UserBubble, { text: evil }));
    expect(u).not.toContain('<img');
    const t = html(h(TurnView, { turn: { localId: 'l', stepId: 's4', question: evil, answer: evil, status: 'streaming' }, onRetry: noop }));
    expect(t).not.toContain('<img');
    expect(t).not.toContain('<script');
  });
});

describe('assistant answer provenance', () => {
  it('a normal answer is labelled as Instructor\'s explanation and has no blockquote', () => {
    const a = html(h(AssistantAnswer, { message: m(), env, onOpenManual: noop }));
    expect(a).toContain(esc(COPY.instructorNote));
    expect(a).not.toContain('<blockquote');
    expect(a).not.toContain('FROM YOUR MANUAL');
  });
  it('not-in-manual answers get the distinct frame and the manual link, and never citations', () => {
    const a = html(h(AssistantAnswer, { message: m({ notInManual: true, text: 'The manual does not say.', citations: [{ pageIndex: 1 }] }), env, onOpenManual: noop }));
    expect(a).toContain('data-kind="not-in-manual"');
    expect(a).toContain('NOT IN YOUR MANUAL');
    expect(a).toContain('Open the original manual');
    expect(a).not.toContain('data-testid="citations"');
  });
});

describe('citation chips', () => {
  it('a step citation has a step chip and a page chip; a page-only one has just the page chip', () => {
    const a = html(h(AssistantAnswer, { message: m({ citations: [{ pageIndex: 2, stepId: 's4' }, { pageIndex: 0 }] }), env, onOpenManual: noop }));
    expect(a).toContain('aria-label="Go to step 4"');
    expect(a).toContain('aria-label="Open manual page 3, step 4"');
    expect(a).toContain('aria-label="Open manual page 1"');
    expect((a.match(/data-testid="cite-step"/g) ?? []).length).toBe(1);
  });
  it('drops pages the manual does not have and ignores unknown step ids', () => {
    const a = html(h(AssistantAnswer, { message: m({ citations: [{ pageIndex: 40, stepId: 's4' }, { pageIndex: 1, stepId: 'zzz' }] }), env, onOpenManual: noop }));
    expect(a).not.toContain('page 41');
    expect(a).toContain('Open manual page 2');
    expect(a).not.toContain('Go to step');
  });
});

describe('turn states', () => {
  const turn = (code: string) => ({ localId: 'l', stepId: 's4', question: 'Why?', answer: '', status: 'failed' as const, error: { code, message: 'server text' } });
  it('a failed answer keeps the question, says what happened and offers Try again', () => {
    const t = html(h(TurnView, { turn: turn('provider_error'), onRetry: noop }));
    expect(t).toContain('Why?');
    expect(t).toContain("That didn&#x27;t go through.");
    expect(t).toContain('Try again');
    expect(t).not.toContain('server text');
  });
  it('rate limited and busy have their own copy', () => {
    expect(html(h(TurnView, { turn: turn('rate_limited'), onRetry: noop }))).toContain(esc(COPY.rateLimited));
    expect(html(h(TurnView, { turn: turn('busy'), onRetry: noop }))).toContain(esc(COPY.busy));
  });
  it('the question limit has no retry', () => {
    const t = html(h(TurnView, { turn: turn('message_limit'), onRetry: noop }));
    expect(t).toContain('question limit');
    expect(t).not.toContain('turn-retry');
  });
  it('streaming shows a caret that is hidden from assistive technology', () => {
    const t = html(h(TurnView, { turn: { localId: 'l', stepId: 's4', question: 'q', answer: 'abc', status: 'streaming' }, onRetry: noop }));
    expect(t).toContain('data-testid="caret"');
    expect(t).toContain('aria-hidden="true"');
    expect(t).not.toContain('aria-live');
  });
});

describe('divider and composer', () => {
  it('divider names the step', () => {
    expect(html(h(StepDivider, { number: 7 }))).toContain('ABOUT STEP 7');
  });
  it('composer is disabled and explained when offline, and Stop replaces Send while streaming', () => {
    const off = html(h(Composer, { busy: false, disabledReason: COPY.offline, onSend: noop, onStop: noop }));
    expect(off).toContain('disabled');
    expect(off).toContain("You&#x27;re offline. Questions need a connection.");
    const busy = html(h(Composer, { busy: true, onSend: noop, onStop: noop }));
    expect(busy).toContain('composer-stop');
    expect(busy).not.toContain('composer-send');
    expect(html(h(Composer, { busy: false, onSend: noop, onStop: noop }))).toContain('Answers come only from your manual.');
  });
});
