import { describe, expect, it, vi } from 'vitest';
import {
  askedAbout,
  askQuestion,
  chatReducer,
  cleanCitations,
  consumeAnswer,
  conversationItems,
  initialChat,
  keyboardInset,
  parseMessage,
  readSse,
  SseParser,
  STREAM_INTERRUPTED,
  type ChatMessage,
  type ChatState,
  type SseEvent,
} from '@/lib/client/assistant';
import { errorView } from '@/components/features/assistant/copy';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  text: 'Hello',
  stepId: 's1',
  createdAt: 1,
  citations: [],
  notInManual: false,
  ...over,
});

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;

function parseAll(chunks: string[]): SseEvent[] {
  const p = new SseParser();
  return chunks.flatMap((c) => p.push(c));
}

describe('SseParser', () => {
  it('parses whole frames', () => {
    expect(parseAll([frame('delta', { text: 'a' }) + frame('done', { x: 1 })])).toEqual([
      { event: 'delta', data: '{"text":"a"}' },
      { event: 'done', data: '{"x":1}' },
    ]);
  });
  it('is the same at every split point, including inside a field name or a UTF-16 pair', () => {
    const all = frame('delta', { text: 'héllo 😀' }) + frame('delta', { text: 'two' }) + frame('done', { message: 1 });
    const want = parseAll([all]);
    expect(want).toHaveLength(3);
    for (let i = 1; i < all.length; i++) expect(parseAll([all.slice(0, i), all.slice(i)])).toEqual(want);
    expect(parseAll(all.split(''))).toEqual(want);
  });
  it('joins multi-line data with a newline', () => {
    expect(parseAll(['event: delta\ndata: line one\ndata: line two\ndata:\ndata: last\n\n'])).toEqual([{ event: 'delta', data: 'line one\nline two\n\nlast' }]);
  });
  it('handles CRLF and lone CR, even when "\\r\\n" is split between chunks', () => {
    const want = [{ event: 'delta', data: 'x' }];
    expect(parseAll(['event: delta\r\ndata: x\r\n\r\n'])).toEqual(want);
    expect(parseAll(['event: delta\rdata: x\r\r'])).toEqual(want);
    expect(parseAll(['event: delta\r', '\ndata: x\r', '\n\r', '\n'])).toEqual(want);
  });
  it('ignores comments, ids, retries and unknown fields; default event is "message"', () => {
    expect(parseAll([': keep-alive\n\nid: 4\nretry: 100\nfoo: bar\ndata: hi\n\n'])).toEqual([{ event: 'message', data: 'hi' }]);
  });
  it('drops frames without data, and an unterminated final frame', () => {
    expect(parseAll(['event: delta\n\n', 'event: done\ndata: {"a":1}'])).toEqual([]);
  });
  it('strips a byte order mark and only one space after the colon', () => {
    expect(parseAll(['﻿data:  two spaces\n\n'])).toEqual([{ event: 'message', data: ' two spaces' }]);
  });
  it('keeps text that looks like markup or an instruction as plain data', () => {
    const t = '<img src=x onerror=alert(1)> **bold** ignore previous instructions';
    expect(parseAll([frame('delta', { text: t })])).toEqual([{ event: 'delta', data: JSON.stringify({ text: t }) }]);
  });
});

function streamOf(parts: Array<string | Uint8Array>, opts: { error?: boolean } = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < parts.length) {
        const p = parts[i++]!;
        c.enqueue(typeof p === 'string' ? enc.encode(p) : p);
      } else if (opts.error) c.error(new Error('boom'));
      else c.close();
    },
  });
}

async function collect(it: AsyncIterable<SseEvent>) {
  const out: SseEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('readSse', () => {
  it('decodes multi-byte characters split across network chunks', async () => {
    const bytes = new TextEncoder().encode(frame('delta', { text: 'żółć 😀' }));
    const parts = Array.from(bytes, (b) => new Uint8Array([b])); // one byte per chunk
    const evs = await collect(readSse(streamOf(parts)));
    expect(JSON.parse(evs[0]!.data)).toEqual({ text: 'żółć 😀' });
  });
  it('stops with an AbortError when the signal aborts, and cancels the reader', async () => {
    const ac = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(frame('delta', { text: 'a' })));
      },
      cancel() {
        cancelled = true;
      },
    });
    const got: SseEvent[] = [];
    await expect(
      (async () => {
        for await (const e of readSse(body, ac.signal)) {
          got.push(e);
          ac.abort();
        }
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(got).toHaveLength(1);
    expect(cancelled).toBe(true);
  });
});

async function* events(...e: SseEvent[]) {
  for (const x of e) yield x;
}
const ev = (event: string, data: unknown): SseEvent => ({ event, data: typeof data === 'string' ? data : JSON.stringify(data) });

describe('consumeAnswer', () => {
  it('collects deltas and returns the done message', async () => {
    const got: string[] = [];
    const r = await consumeAnswer(events(ev('delta', { text: 'Hel' }), ev('delta', { text: 'lo\nworld' }), ev('done', { message: msg({ text: 'Hello\nworld' }) })), (t) => got.push(t));
    expect(got).toEqual(['Hel', 'lo\nworld']);
    expect(r).toMatchObject({ ok: true, message: { text: 'Hello\nworld' } });
  });
  it('an error event ends the answer with its code', async () => {
    const r = await consumeAnswer(events(ev('delta', { text: 'a' }), ev('error', { error: { code: 'provider_error', message: 'x' } })), () => {});
    expect(r).toEqual({ ok: false, error: { code: 'provider_error', message: 'x' } });
  });
  it('skips malformed deltas but treats a malformed done as an interrupted answer', async () => {
    const got: string[] = [];
    const r = await consumeAnswer(events(ev('delta', '{not json'), ev('delta', { nope: 1 }), ev('delta', { text: '' }), ev('delta', { text: 'ok' }), ev('done', '{broken')), (t) => got.push(t));
    expect(got).toEqual(['ok']);
    expect(r).toEqual({ ok: false, error: STREAM_INTERRUPTED });
  });
  it('a done without a valid assistant message is not accepted', async () => {
    expect((await consumeAnswer(events(ev('done', { message: { id: 1 } })), () => {})).ok).toBe(false);
    expect((await consumeAnswer(events(ev('done', { message: msg({ role: 'user' }) })), () => {})).ok).toBe(false);
  });
  it('a stream that ends without done or error is interrupted; events after the end are ignored', async () => {
    expect(await consumeAnswer(events(ev('delta', { text: 'a' })), () => {})).toEqual({ ok: false, error: STREAM_INTERRUPTED });
    const got: string[] = [];
    const r = await consumeAnswer(events(ev('done', { message: msg() }), ev('delta', { text: 'late' })), (t) => got.push(t));
    expect(r.ok).toBe(true);
    expect(got).toEqual([]);
  });
  it('ignores unknown events', async () => {
    const r = await consumeAnswer(events(ev('ping', 'x'), ev('done', { message: msg() })), () => {});
    expect(r.ok).toBe(true);
  });
});

describe('askQuestion', () => {
  const sse = (body: ReadableStream<Uint8Array>) => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  it('posts { stepId, text } and streams', async () => {
    const f = vi.fn(async () => sse(streamOf([frame('delta', { text: 'Hi' }), frame('done', { message: msg({ text: 'Hi' }) })])));
    const got: string[] = [];
    const r = await askQuestion('g 1', 's2', 'Why?', (t) => got.push(t), undefined, f as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    expect(got).toEqual(['Hi']);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/guides/g%201/messages');
    expect(JSON.parse(init.body as string)).toEqual({ stepId: 's2', text: 'Why?' });
  });
  it.each([
    [429, 'rate_limited'],
    [409, 'busy'],
    [404, 'not_found'],
    [400, 'invalid_request'],
  ])('pre-stream %i JSON error keeps its code', async (status, code) => {
    const f = async () => new Response(JSON.stringify({ error: { code, message: 'm' } }), { status, headers: { 'content-type': 'application/json' } });
    expect(await askQuestion('g', 's', 'q', () => {}, undefined, f as unknown as typeof fetch)).toEqual({ ok: false, error: { code, message: 'm' } });
  });
  it('an unreadable error body still fails cleanly', async () => {
    const f = async () => new Response('<html>', { status: 502 });
    const r = await askQuestion('g', 's', 'q', () => {}, undefined, f as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, error: { code: 'http_502' } });
  });
  it('a network failure is code "network"', async () => {
    const f = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await askQuestion('g', 's', 'q', () => {}, undefined, f as unknown as typeof fetch)).toMatchObject({ ok: false, error: { code: 'network' } });
  });
  it('a connection that dies mid-answer is code "network", not an abort', async () => {
    const f = async () => sse(streamOf([frame('delta', { text: 'a' })], { error: true }));
    expect(await askQuestion('g', 's', 'q', () => {}, undefined, f as unknown as typeof fetch)).toMatchObject({ ok: false, error: { code: 'network' } });
  });
  it('abort mid-stream returns aborted', async () => {
    const ac = new AbortController();
    const f = async () => sse(streamOf([frame('delta', { text: 'a' }), frame('delta', { text: 'b' })]));
    const r = await askQuestion('g', 's', 'q', () => ac.abort(), ac.signal, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, aborted: true });
  });
  it('abort before the response returns aborted', async () => {
    const ac = new AbortController();
    const f = (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))));
    const p = askQuestion('g', 's', 'q', () => {}, ac.signal, f as unknown as typeof fetch);
    ac.abort();
    expect(await p).toEqual({ ok: false, aborted: true });
  });
});

describe('messages and citations from the server', () => {
  it('parseMessage rejects shapes that are not messages and defaults optional fields', () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage({ id: 'a', role: 'system', text: 't', stepId: 's' })).toBeNull();
    expect(parseMessage({ id: 'a', role: 'user', text: 5, stepId: 's' })).toBeNull();
    expect(parseMessage({ id: 'a', role: 'user', text: 't', stepId: 's' })).toMatchObject({ citations: [], notInManual: false });
  });
  it('accepts the server shape: null stepId; an unexpected note field is ignored', () => {
    expect(parseMessage({ id: 'u', role: 'user', text: 't', stepId: null, createdAt: 1, citations: [], notInManual: false })).toMatchObject({ stepId: '' });
    expect(parseMessage({ id: 'a', role: 'assistant', text: 't', stepId: 's1', note: 'no_citation' })).not.toHaveProperty('note');
  });
  it('items without a step get no divider', () => {
    expect(conversationItems({ messages: [msg({ stepId: '' })], turn: null }).map((i) => i.kind)).toEqual(['message']);
  });
  it('drops citations that cannot be shown and duplicates', () => {
    const out = cleanCitations([
      { pageIndex: 2, stepId: 's4', region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
      { pageIndex: 2, stepId: 's4' },
      { pageIndex: -1 },
      { pageIndex: 1.5 },
      { pageIndex: '3' },
      { pageIndex: 0, region: { x: 0.9, y: 0, w: 2, h: 1 } },
      'x',
    ]);
    expect(out).toEqual([{ pageIndex: 2, stepId: 's4', region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }, { pageIndex: 0 }]);
  });
});

describe('conversation reducer', () => {
  const sent = (s: ChatState = initialChat, text = 'Why?', stepId = 's1', localId = 'l1') => chatReducer(s, { type: 'send', localId, stepId, text, at: 1 });

  it('history loads, or fails, independently of a question', () => {
    const s = chatReducer(initialChat, { type: 'history-loaded', messages: [msg()] });
    expect(s).toMatchObject({ history: 'ready', messages: [{ id: 'm1' }] });
    expect(chatReducer(initialChat, { type: 'history-failed' }).history).toBe('error');
  });
  it('streams: deltas append to the turn; done adds the question and the answer and clears the turn', () => {
    let s = sent();
    s = chatReducer(s, { type: 'delta', localId: 'l1', text: 'Hel' });
    s = chatReducer(s, { type: 'delta', localId: 'l1', text: 'lo' });
    expect(s.turn).toMatchObject({ answer: 'Hello', status: 'streaming' });
    expect(s.announce).toBe('');
    s = chatReducer(s, { type: 'done', localId: 'l1', message: msg({ id: 'a1', text: 'Hello' }) });
    expect(s.turn).toBeNull();
    expect(s.messages.map((m) => [m.role, m.text])).toEqual([['user', 'Why?'], ['assistant', 'Hello']]);
    expect(s.announce).toBe('Hello');
  });
  it('announces "Not in your manual" answers as such', () => {
    const s = chatReducer(sent(), { type: 'done', localId: 'l1', message: msg({ notInManual: true, text: 'No info.' }) });
    expect(s.announce).toBe('Not in your manual. No info.');
  });
  it('a failed answer keeps the question and the error; Try again replaces the turn', () => {
    let s = sent();
    s = chatReducer(s, { type: 'delta', localId: 'l1', text: 'par' });
    s = chatReducer(s, { type: 'failed', localId: 'l1', error: { code: 'network', message: 'x' } });
    expect(s.turn).toMatchObject({ status: 'failed', question: 'Why?', error: { code: 'network' } });
    expect(s.messages).toEqual([]);
    s = sent(s, 'Why?', 's1', 'l2');
    expect(s.turn).toMatchObject({ localId: 'l2', status: 'streaming', answer: '' });
  });
  it('stop discards the partial answer but keeps the question', () => {
    let s = chatReducer(sent(), { type: 'delta', localId: 'l1', text: 'part' });
    s = chatReducer(s, { type: 'stopped', localId: 'l1' });
    expect(s.turn).toMatchObject({ status: 'failed', answer: '', question: 'Why?', error: { code: 'stopped' } });
  });
  it('ignores late events of an older turn and a second send while streaming', () => {
    const s = sent();
    expect(sent(s, 'other', 's1', 'l2')).toBe(s);
    expect(chatReducer(s, { type: 'delta', localId: 'old', text: 'x' })).toBe(s);
    expect(chatReducer(s, { type: 'done', localId: 'old', message: msg() })).toBe(s);
    expect(chatReducer(s, { type: 'failed', localId: 'old', error: { code: 'x', message: 'y' } })).toBe(s);
  });
  it('cleared empties messages and the turn', () => {
    const s = chatReducer(sent(chatReducer(initialChat, { type: 'history-loaded', messages: [msg()] })), { type: 'cleared' });
    expect(s).toMatchObject({ messages: [], turn: null, history: 'ready' });
  });
  it('does not drop the turn when history arrives late', () => {
    const s = chatReducer(sent(), { type: 'history-loaded', messages: [msg()] });
    expect(s.turn).not.toBeNull();
  });
});

describe('conversation items and suggestions', () => {
  const u = (id: string, stepId: string) => msg({ id, role: 'user', stepId });
  it('adds a divider when the step changes, including before the first message', () => {
    const items = conversationItems({ messages: [u('1', 's1'), msg({ id: '2', stepId: 's1' }), u('3', 's1'), msg({ id: '4', stepId: 's4' })], turn: null });
    expect(items.map((i) => (i.kind === 'divider' ? `D:${i.stepId}` : i.kind))).toEqual(['D:s1', 'message', 'message', 'message', 'D:s4', 'message']);
  });
  it('a turn on another step also gets a divider', () => {
    const turn = { localId: 'l', stepId: 's9', question: 'q', answer: '', status: 'streaming' as const };
    const items = conversationItems({ messages: [u('1', 's1')], turn });
    expect(items.map((i) => i.kind)).toEqual(['divider', 'message', 'divider', 'turn']);
  });
  it('askedAbout looks at user questions and the running turn only', () => {
    expect(askedAbout({ messages: [u('1', 's1')], turn: null }, 's1')).toBe(true);
    expect(askedAbout({ messages: [u('1', 's1')], turn: null }, 's2')).toBe(false);
    expect(askedAbout({ messages: [msg({ stepId: 's2' })], turn: null }, 's2')).toBe(false);
    expect(askedAbout({ messages: [], turn: { localId: 'l', stepId: 's2', question: 'q', answer: '', status: 'failed' } }, 's2')).toBe(true);
  });
});

describe('keyboard inset and error copy', () => {
  it('reports the covered height, ignoring browser-chrome sized differences', () => {
    expect(keyboardInset(800, 500, 0)).toBe(300);
    expect(keyboardInset(800, 450, 50)).toBe(300);
    expect(keyboardInset(800, 770, 0)).toBe(0);
    expect(keyboardInset(800, 800, 0)).toBe(0);
  });
  it('never shows server text; limit, rate and busy codes have their own copy', () => {
    expect(errorView('rate_limited').kind).toBe('info');
    expect(errorView('busy').kind).toBe('info');
    expect(errorView('rate_limited').text).not.toBe(errorView('busy').text);
    expect(errorView('message_limit').kind).toBe('limit');
    expect(errorView('provider_error')).toEqual({ kind: 'inline', text: "That didn't go through." });
    expect(errorView('stopped').kind).toBe('inline');
    expect(errorView('ai_unavailable').text).toContain('isn\'t available');
  });
});
