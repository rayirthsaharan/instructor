'use client';

// Client side of the step-aware assistant (M3): typed API calls, the SSE reader, the conversation reducer and the
// hooks that glue them to React. The wire contract is fixed (see the M3 brief / docs/API.md).
// Everything the model says is data: it is only ever rendered as text.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

// ---------------------------------------------------------------------------------------------------- types

export interface Citation {
  stepId?: string;
  /** 0-based page index. */
  pageIndex: number;
  region?: { x: number; y: number; w: number; h: number };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  stepId: string;
  createdAt: number | string;
  citations: Citation[];
  notInManual: boolean;
  note?: string;
}

export interface AssistantError {
  code: string;
  message: string;
}

export const MAX_QUESTION_CHARS = 1000;
/** The counter appears once the question is this close to the limit. */
export const COUNTER_FROM = 800;

// ------------------------------------------------------------------------------------------------ validation

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num01 = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Keeps only citations that can be shown: an integer page and, when present, a well-formed region. */
export function cleanCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) return [];
  const out: Citation[] = [];
  for (const c of raw) {
    if (!isObj(c)) continue;
    const pageIndex = c.pageIndex;
    if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex) || pageIndex < 0) continue;
    const cit: Citation = { pageIndex };
    if (typeof c.stepId === 'string' && c.stepId) cit.stepId = c.stepId;
    const r = c.region;
    if (isObj(r) && num01(r.x) && num01(r.y) && num01(r.w) && num01(r.h) && (r.w as number) > 0 && (r.h as number) > 0) {
      cit.region = { x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number };
    }
    if (!out.some((o) => o.pageIndex === cit.pageIndex && o.stepId === cit.stepId)) out.push(cit);
  }
  return out;
}

/** Normalises a message from the server; null when it is not a usable message. */
export function parseMessage(raw: unknown): ChatMessage | null {
  if (!isObj(raw)) return null;
  const { id, role, text, stepId, createdAt } = raw;
  if (typeof id !== 'string' || (role !== 'user' && role !== 'assistant') || typeof text !== 'string') return null;
  if (stepId !== null && stepId !== undefined && typeof stepId !== 'string') return null;
  return {
    id,
    role,
    text,
    stepId: stepId ?? '',
    createdAt: typeof createdAt === 'number' || typeof createdAt === 'string' ? createdAt : 0,
    citations: cleanCitations(raw.citations),
    notInManual: raw.notInManual === true,
    note: typeof raw.note === 'string' && raw.note ? raw.note : undefined,
  };
}

// --------------------------------------------------------------------------------------------------- SSE

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Incremental Server-Sent-Events parser. Feed it text as it arrives (events may be split anywhere, including inside a
 * line or between "\r" and "\n"); it returns the events completed by that chunk. Comment lines, `id` and `retry` are
 * ignored; several `data:` lines are joined with "\n"; a frame without data is dropped.
 */
export class SseParser {
  private buf = '';
  private event = '';
  private data: string[] = [];
  private hasData = false;
  private first = true;
  private pendingCr = false;

  push(chunk: string): SseEvent[] {
    let s = chunk;
    if (this.first && s.length > 0) {
      this.first = false;
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    }
    // A "\r" at the end of the previous chunk may be the first half of "\r\n".
    if (this.pendingCr) {
      this.pendingCr = false;
      if (s.startsWith('\n')) s = s.slice(1);
    }
    this.buf += s;
    const out: SseEvent[] = [];
    let i = 0;
    for (;;) {
      let end = -1;
      let skip = 1;
      for (let j = i; j < this.buf.length; j++) {
        const ch = this.buf[j];
        if (ch === '\n') {
          end = j;
          break;
        }
        if (ch === '\r') {
          if (j + 1 >= this.buf.length) {
            // Cannot tell "\r" from "\r\n" yet: treat as a line end and swallow a following "\n" next time.
            end = j;
            this.pendingCr = true;
          } else {
            end = j;
            if (this.buf[j + 1] === '\n') skip = 2;
          }
          break;
        }
      }
      if (end < 0) break;
      const line = this.buf.slice(i, end);
      i = end + skip;
      const ev = this.line(line);
      if (ev) out.push(ev);
    }
    this.buf = this.buf.slice(i);
    return out;
  }

  /** End of stream: a final unterminated line is discarded (an event is only complete after its blank line). */
  private line(line: string): SseEvent | null {
    if (line === '') {
      const ev = this.hasData ? { event: this.event || 'message', data: this.data.join('\n') } : null;
      this.event = '';
      this.data = [];
      this.hasData = false;
      return ev;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') {
      this.data.push(value);
      this.hasData = true;
    }
    return null;
  }
}

/** Reads a response body as SSE events until it ends or `signal` aborts (then it throws the abort reason). */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort);
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (done) {
        for (const ev of parser.push(decoder.decode())) yield ev;
        return;
      }
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) yield ev;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

// ----------------------------------------------------------------------------------------- answer streaming

export type StreamResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; aborted: true }
  | { ok: false; aborted?: false; error: AssistantError };

export const STREAM_INTERRUPTED: AssistantError = { code: 'stream_interrupted', message: 'The answer stopped before it finished.' };

function errorFrom(v: unknown, fallback: AssistantError): AssistantError {
  const e = isObj(v) && isObj(v.error) ? v.error : isObj(v) ? v : null;
  const code = e && typeof e.code === 'string' ? e.code : fallback.code;
  const message = e && typeof e.message === 'string' ? e.message : fallback.message;
  return { code, message };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Consumes the events of one answer. `delta` frames with bad JSON or no text are skipped; the stream must end with
 * exactly one `done` (valid message) or `error`; anything else is `stream_interrupted`. Events after the first
 * terminal one are ignored.
 */
export async function consumeAnswer(events: AsyncIterable<SseEvent>, onDelta: (text: string) => void): Promise<StreamResult> {
  for await (const ev of events) {
    if (ev.event === 'delta') {
      const j = safeJson(ev.data);
      if (isObj(j) && typeof j.text === 'string' && j.text) onDelta(j.text);
    } else if (ev.event === 'done') {
      const j = safeJson(ev.data);
      const message = isObj(j) ? parseMessage(j.message) : null;
      if (message && message.role === 'assistant') return { ok: true, message };
      return { ok: false, error: STREAM_INTERRUPTED };
    } else if (ev.event === 'error') {
      return { ok: false, error: errorFrom(safeJson(ev.data), STREAM_INTERRUPTED) };
    }
  }
  return { ok: false, error: STREAM_INTERRUPTED };
}

const enc = encodeURIComponent;

/** POST a question and stream the answer. Never throws: failures come back as `{ ok: false }`. */
export async function askQuestion(
  guideId: string,
  stepId: string,
  text: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<StreamResult> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/guides/${enc(guideId)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ stepId, text }),
      cache: 'no-store',
      signal,
    });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return { ok: false, aborted: true };
    return { ok: false, error: { code: 'network', message: 'Network error' } };
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('text/event-stream') || !res.body) {
    const j = safeJson(await res.text().catch(() => ''));
    return { ok: false, error: errorFrom(j, { code: res.ok ? 'bad_response' : `http_${res.status}`, message: `Request failed (${res.status})` }) };
  }
  try {
    return await consumeAnswer(readSse(res.body, signal), onDelta);
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return { ok: false, aborted: true };
    return { ok: false, error: { code: 'network', message: 'Network error' } };
  }
}

// ------------------------------------------------------------------------------------------------ plain API

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export async function fetchHistory(guideId: string, signal?: AbortSignal): Promise<ChatMessage[]> {
  const j = await getJson(`/api/guides/${enc(guideId)}/messages`, signal);
  const list = isObj(j) && Array.isArray(j.messages) ? j.messages : [];
  return list.map(parseMessage).filter((m): m is ChatMessage => m !== null);
}

export async function clearHistory(guideId: string): Promise<void> {
  const res = await fetch(`/api/guides/${enc(guideId)}/messages`, { method: 'DELETE', cache: 'no-store' });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
}

export async function fetchSuggestions(guideId: string, stepId: string, signal?: AbortSignal): Promise<string[]> {
  const j = await getJson(`/api/guides/${enc(guideId)}/suggestions?stepId=${enc(stepId)}`, signal);
  const list = isObj(j) && Array.isArray(j.suggestions) ? j.suggestions : [];
  return list.filter((s): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= MAX_QUESTION_CHARS).slice(0, 5);
}

export interface Simplified {
  text: string;
  cached: boolean;
  fellBack: boolean;
}

export async function simplifyStep(guideId: string, stepId: string, signal?: AbortSignal): Promise<Simplified> {
  const res = await fetch(`/api/guides/${enc(guideId)}/steps/${enc(stepId)}/simplify`, { method: 'POST', cache: 'no-store', signal });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = (await res.json()) as unknown;
  if (!isObj(j) || typeof j.text !== 'string') throw new Error('Unexpected response');
  return { text: j.text, cached: j.cached === true, fellBack: j.fellBack === true };
}

// ------------------------------------------------------------------------------------------------ reducer

/** A question in flight, or one that failed (its text is kept so the user can try again). */
export interface Turn {
  localId: string;
  stepId: string;
  question: string;
  /** Answer text received so far. */
  answer: string;
  status: 'streaming' | 'failed';
  error?: AssistantError;
}

export interface ChatState {
  history: 'loading' | 'ready' | 'error';
  messages: ChatMessage[];
  turn: Turn | null;
  /** Text for the polite live region: set once when an answer is complete, never per token. */
  announce: string;
}

export type ChatAction =
  | { type: 'history-loading' }
  | { type: 'history-loaded'; messages: ChatMessage[] }
  | { type: 'history-failed' }
  | { type: 'send'; localId: string; stepId: string; text: string; at: number }
  | { type: 'delta'; localId: string; text: string }
  | { type: 'done'; localId: string; message: ChatMessage }
  | { type: 'failed'; localId: string; error: AssistantError }
  | { type: 'stopped'; localId: string }
  | { type: 'cleared' };

export const initialChat: ChatState = { history: 'loading', messages: [], turn: null, announce: '' };

export function chatReducer(state: ChatState, a: ChatAction): ChatState {
  switch (a.type) {
    case 'history-loading':
      return { ...state, history: 'loading' };
    case 'history-loaded':
      return { ...state, history: 'ready', messages: a.messages };
    case 'history-failed':
      return { ...state, history: 'error' };
    case 'send':
      // A new question replaces a failed one (that is "Try again"); it is never added on top of a running one.
      if (state.turn?.status === 'streaming') return state;
      return { ...state, announce: '', turn: { localId: a.localId, stepId: a.stepId, question: a.text, answer: '', status: 'streaming' } };
    case 'delta':
      if (state.turn?.localId !== a.localId || state.turn.status !== 'streaming') return state;
      return { ...state, turn: { ...state.turn, answer: state.turn.answer + a.text } };
    case 'done': {
      const t = state.turn;
      if (t?.localId !== a.localId) return state;
      const user: ChatMessage = { id: `local-${t.localId}`, role: 'user', text: t.question, stepId: t.stepId, createdAt: Date.now(), citations: [], notInManual: false };
      return { ...state, messages: [...state.messages, user, a.message], turn: null, announce: `${a.message.notInManual ? 'Not in your manual. ' : ''}${a.message.text}` };
    }
    case 'failed':
      if (state.turn?.localId !== a.localId) return state;
      return { ...state, turn: { ...state.turn, status: 'failed', error: a.error } };
    case 'stopped':
      // Stop: the partial answer is discarded and the question is kept, so it can be sent again.
      if (state.turn?.localId !== a.localId) return state;
      return { ...state, turn: { ...state.turn, answer: '', status: 'failed', error: { code: 'stopped', message: 'Stopped.' } } };
    case 'cleared':
      return { ...state, messages: [], turn: null, announce: '' };
  }
}

/** Items of the conversation with a "ABOUT STEP n" divider whenever the step differs from the one before. */
export type ConversationItem =
  | { kind: 'divider'; stepId: string }
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'turn'; turn: Turn };

export function conversationItems(state: Pick<ChatState, 'messages' | 'turn'>): ConversationItem[] {
  const items: ConversationItem[] = [];
  let prev: string | null = null;
  const mark = (stepId: string) => {
    if (stepId && stepId !== prev) items.push({ kind: 'divider', stepId });
    if (stepId) prev = stepId;
  };
  for (const m of state.messages) {
    mark(m.stepId);
    items.push({ kind: 'message', message: m });
  }
  if (state.turn) {
    mark(state.turn.stepId);
    items.push({ kind: 'turn', turn: state.turn });
  }
  return items;
}

/** True when a question has already been asked about this step (suggestions are hidden then). */
export const askedAbout = (state: Pick<ChatState, 'messages' | 'turn'>, stepId: string): boolean =>
  state.messages.some((m) => m.role === 'user' && m.stepId === stepId) || state.turn?.stepId === stepId;

/** Distance the on-screen keyboard covers at the bottom of the layout viewport. */
export function keyboardInset(innerHeight: number, vvHeight: number, vvOffsetTop: number): number {
  const v = Math.round(innerHeight - vvHeight - vvOffsetTop);
  return v > 80 ? v : 0; // small differences are browser chrome, not a keyboard
}

// ----------------------------------------------------------------------------------------------- hooks

export const DEFAULT_SUGGESTIONS = ['What does this mean?', 'Which piece is this?', 'Why am I doing this?'];

export interface Assistant {
  state: ChatState;
  suggestions: string[];
  send: (text: string) => void;
  retry: () => void;
  stop: () => void;
  clear: () => Promise<boolean>;
  reloadHistory: () => void;
  busy: boolean;
}

let localCounter = 0;

/**
 * Conversation state for one guide. History loads when `active` first becomes true; suggestions load per step.
 * `stepId` is read when a question is sent, so navigating steps while the panel is open changes the next question.
 */
export function useAssistant(guideId: string, stepId: string, active: boolean): Assistant {
  const [state, dispatch] = useReducer(chatReducer, initialChat);
  const [suggested, setSuggested] = useState<{ stepId: string; list: string[] } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const loadedFor = useRef<string | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const loadHistory = useCallback(() => {
    const ac = new AbortController();
    dispatch({ type: 'history-loading' });
    fetchHistory(guideId, ac.signal).then(
      (messages) => dispatch({ type: 'history-loaded', messages }),
      () => {
        if (!ac.signal.aborted) dispatch({ type: 'history-failed' });
      },
    );
    return ac;
  }, [guideId]);

  useEffect(() => {
    if (!active || loadedFor.current === guideId) return;
    loadedFor.current = guideId;
    loadHistory();
  }, [active, guideId, loadHistory]);

  const asked = askedAbout(state, stepId);
  const needSuggestions = active && !asked && suggested?.stepId !== stepId;
  useEffect(() => {
    if (!needSuggestions) return;
    const ac = new AbortController();
    fetchSuggestions(guideId, stepId, ac.signal).then(
      (list) => setSuggested({ stepId, list }),
      () => {
        if (!ac.signal.aborted) setSuggested({ stepId, list: [] });
      },
    );
    return () => ac.abort();
  }, [needSuggestions, guideId, stepId]);

  // Leaving the guide cancels a running request.
  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(
    (text: string, forStep: string) => {
      if (stateRef.current.turn?.status === 'streaming') return;
      const localId = `${Date.now().toString(36)}-${++localCounter}`;
      const ac = new AbortController();
      abort.current = ac;
      dispatch({ type: 'send', localId, stepId: forStep, text, at: Date.now() });
      void askQuestion(guideId, forStep, text, (t) => dispatch({ type: 'delta', localId, text: t }), ac.signal).then((r) => {
        if (abort.current === ac) abort.current = null;
        if (r.ok) dispatch({ type: 'done', localId, message: r.message });
        else if (r.aborted) dispatch({ type: 'stopped', localId });
        else dispatch({ type: 'failed', localId, error: r.error });
      });
    },
    [guideId],
  );

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (t && t.length <= MAX_QUESTION_CHARS) run(t, stepId);
    },
    [run, stepId],
  );

  const retry = useCallback(() => {
    const t = stateRef.current.turn;
    if (t && t.status === 'failed') run(t.question, t.stepId);
  }, [run]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const clear = useCallback(async () => {
    abort.current?.abort();
    try {
      await clearHistory(guideId);
    } catch {
      return false;
    }
    dispatch({ type: 'cleared' });
    return true;
  }, [guideId]);

  const reloadHistory = useCallback(() => void loadHistory(), [loadHistory]);

  const list = suggested?.stepId === stepId ? suggested.list : null;
  return {
    state,
    suggestions: asked ? [] : list === null ? [] : list.length > 0 ? list : DEFAULT_SUGGESTIONS,
    send,
    retry,
    stop,
    clear,
    reloadHistory,
    busy: state.turn?.status === 'streaming',
  };
}

// ---------------------------------------------------------------------------------------- simpler wording

export type SimplerState = { status: 'loading' } | { status: 'error' } | ({ status: 'done' } & Simplified);

/** "Explain it more simply": requests a step's simpler wording once it is wanted; results are kept per step. */
export function useSimpler(guideId: string, stepId: string, wanted: boolean) {
  const [byStep, setByStep] = useState<Record<string, SimplerState>>({});
  const started = useRef(new Set<string>());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!wanted || started.current.has(stepId)) return;
    started.current.add(stepId);
    const key = stepId;
    setByStep((s) => ({ ...s, [key]: { status: 'loading' } }));
    simplifyStep(guideId, key).then(
      (r) => setByStep((s) => ({ ...s, [key]: { status: 'done', ...r } })),
      () => {
        started.current.delete(key);
        setByStep((s) => ({ ...s, [key]: { status: 'error' } }));
      },
    );
  }, [wanted, guideId, stepId, attempt]);

  const retry = useCallback(() => {
    started.current.delete(stepId);
    setAttempt((n) => n + 1);
  }, [stepId]);

  const cur = byStep[stepId];
  return { state: wanted ? (cur ?? ({ status: 'loading' } as const)) : cur, retry };
}
