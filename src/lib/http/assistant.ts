import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getAIProvider, simplifyStepChecked, AIProviderError, type AIProvider, type AnswerEvent } from '../ai';
import { getConfig } from '../config';
import { clearMessages, getSimplification, insertMessages, listMessages, saveSimplification, type MessageRecord, type NewMessage } from '../db';
import { finalizeAnswer, cleanAnswerText, cleanChunk, isEnglish, MAX_ANSWER_CHARS } from '../assistant/guard';
import { QuantityHoldback } from '../assistant/holdback';
import { buildAssistantPrompt, MAX_CONTEXT_MESSAGES } from '../assistant/prompt';
import { acquireStream } from '../assistant/streams';
import { suggestionsForStep } from '../assistant/suggestions';
import { getOwn } from '../guide/selectors';
import type { AppContext, AssistantLimits, SessionInfo } from './context';
import { ownedGuide, readStoredGuide } from './guides';
import { ApiError, json, notFound, readJson } from './respond';

/** Messages returned by GET. */
export const MAX_HISTORY = 100;
const MAX_QUESTION_CHARS = 1000;
const SIMPLIFY_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 };
const SIMPLER_LEVEL = 1;
export const ANSWER_TIMEOUT_MS = 60_000;

const providerFor = (ctx: AppContext): AIProvider => ctx.provider ?? getAIProvider(process.env, { delayMs: getConfig().mockAiDelayMs });

function limitsFor(ctx: AppContext): AssistantLimits {
  if (ctx.assistantLimits) return ctx.assistantLimits;
  const c = getConfig();
  return { messages: { limit: c.assistantMessagesPer10Min, windowMs: 10 * 60 * 1000 }, maxStreams: c.assistantMaxStreams };
}

async function hitOrThrow(ctx: AppContext, key: string, rule: { limit: number; windowMs: number }): Promise<void> {
  const r = await ctx.limiter.hit(key, rule.limit, rule.windowMs);
  if (!r.allowed) throw new ApiError('rate_limited', 'That is a lot of questions in a short time. Please wait a little and try again.', 429, Math.max(1, Math.ceil(r.retryAfterMs / 1000)));
}

// --- views ----------------------------------------------------------------------------------------

export interface MessageView {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  stepId: string | null;
  createdAt: number;
  citations: MessageRecord['citations'];
  notInManual: boolean;
}

const messageView = (m: NewMessage | MessageRecord): MessageView => ({
  id: m.id, role: m.role, text: m.text, stepId: m.stepId, createdAt: m.createdAt, citations: m.citations, notInManual: m.notInManual,
});

// --- history ----------------------------------------------------------------------------------------

export async function getMessages(ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  const owned = await ownedGuide(ctx, session, rawId);
  const rows = await listMessages(ctx.db, owned.guide.id, MAX_HISTORY);
  return json({ messages: rows.map(messageView) });
}

export async function deleteMessages(ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  const owned = await ownedGuide(ctx, session, rawId);
  await clearMessages(ctx.db, owned.guide.id);
  return json({ cleared: true });
}

export async function getSuggestions(req: Request, ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  const owned = await ownedGuide(ctx, session, rawId);
  const stepId = new URL(req.url).searchParams.get('stepId');
  const guide = readStoredGuide(owned);
  if (!stepId || stepId.length > 100 || !getOwn(guide.steps, stepId)) throw new ApiError('invalid_request', 'stepId must be a step of this guide.', 400);
  return json({ suggestions: suggestionsForStep(guide, stepId) });
}

// --- ask (streamed) ---------------------------------------------------------------------------------

const askBody = z.object({ stepId: z.string().min(1).max(100), text: z.string().max(10_000) }).strict();

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * POST a question. Errors found before streaming use the normal JSON shape; once the stream is open the outcome is
 * exactly one `done` or `error` event. The question and the answer are stored together, only after the answer passed
 * the guards, so a failed or cancelled answer leaves no trace and can simply be asked again.
 */
export async function postMessage(req: Request, ctx: AppContext, session: SessionInfo, rawId: string): Promise<Response> {
  const owned = await ownedGuide(ctx, session, rawId);
  const parsed = askBody.safeParse(await readJson(req, 16 * 1024));
  if (!parsed.success) throw new ApiError('invalid_request', 'The question is not in the expected shape.', 400);
  const text = parsed.data.text.trim();
  if (text.length < 1 || text.length > MAX_QUESTION_CHARS) throw new ApiError('invalid_request', `Questions must be 1 to ${MAX_QUESTION_CHARS} characters.`, 400);
  const guide = readStoredGuide(owned);
  const stepId = parsed.data.stepId;
  if (!getOwn(guide.steps, stepId)) throw new ApiError('invalid_request', 'That step is not part of this guide.', 400);

  const limits = limitsFor(ctx);
  const gate = acquireStream(session.sessionId, limits.maxStreams);
  if (!gate.ok) {
    if (gate.reason === 'busy') throw new ApiError('busy', 'Another answer is still being written. Please wait for it to finish.', 409);
    throw new ApiError('rate_limited', 'The assistant is busy right now. Please try again in a moment.', 503, 5);
  }
  try {
    await hitOrThrow(ctx, `assistant:session:${session.sessionId}`, limits.messages);
  } catch (e) {
    gate.release();
    throw e;
  }

  let history;
  try {
    history = (await listMessages(ctx.db, owned.guide.id, MAX_CONTEXT_MESSAGES)).map((m) => ({ role: m.role, content: m.text }));
  } catch (e) {
    gate.release();
    throw e;
  }

  const provider = providerFor(ctx);
  const completedStepIds = owned.progress.completedStepIds;
  const abort = new AbortController(); // the client went away
  const providerCtl = new AbortController(); // stop the provider: client gone, timeout, or overrun
  const stopAll = () => {
    abort.abort();
    providerCtl.abort();
  };
  req.signal?.addEventListener('abort', stopAll, { once: true });
  const askedAt = ctx.now();
  const encoder = new TextEncoder();
  const timeoutMs = limits.answerTimeoutMs ?? ANSWER_TIMEOUT_MS;
  const holdAll = !isEnglish(guide.language);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          open = false;
        }
      };
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        providerCtl.abort();
      }, timeoutMs);
      void (async () => {
        try {
          const prompt = buildAssistantPrompt({ guide, currentStepId: stepId, completedStepIds, history, userText: text });
          const hold = new QuantityHoldback(holdAll);
          let full = '';
          let end: Extract<AnswerEvent, { type: 'done' }> | undefined;
          const it = provider.answerQuestion({ guide, currentStepId: stepId, completedStepIds, message: text, history, prompt, signal: providerCtl.signal })[Symbol.asyncIterator]();
          const stopped = new Promise<'stopped'>((resolve) => {
            if (providerCtl.signal.aborted) resolve('stopped');
            else providerCtl.signal.addEventListener('abort', () => resolve('stopped'), { once: true });
          });
          const halt = () => {
            providerCtl.abort();
            try {
              void Promise.resolve(it.return?.()).catch(() => {});
            } catch {
              /* a stuck provider is abandoned, not awaited */
            }
          };
          for (;;) {
            const pending = it.next();
            pending.catch(() => {}); // a late failure after we stopped waiting must not become an unhandled rejection
            const r = await Promise.race([pending, stopped]);
            if (r === 'stopped') {
              halt();
              if (abort.signal.aborted) return;
              throw new AIProviderError(timedOut ? 'The answer took too long.' : 'The provider was stopped.', 'provider_unavailable', true);
            }
            if (r.done) break;
            const ev = r.value;
            if (ev.type === 'text' && typeof ev.delta === 'string') {
              const piece = cleanChunk(ev.delta);
              full += piece;
              if (full.length > MAX_ANSWER_CHARS * 2) {
                halt();
                throw new AIProviderError('The answer was far longer than allowed.', 'bad_response', false);
              }
              const safe = hold.push(piece);
              if (safe) send('delta', { text: safe });
            } else if (ev.type === 'done') {
              end = ev;
            }
          }
          if (abort.signal.aborted) return;
          if (!end) throw new AIProviderError('The answer ended without a result.', 'bad_response', false);
          const final = finalizeAnswer({ guide, pageCount: owned.document.pageCount ?? 0, text: full, grounded: end.grounded, citations: end.citations });
          for (const issue of final.issues) console.warn(`[assistant] guide ${owned.guide.id}: ${issue.code} ${issue.message}`);
          // Release what was held back, but only if the final text still continues what the user already saw.
          const shown = hold.emitted;
          if (final.text.startsWith(shown) && final.text.length > shown.length && cleanAnswerText(full) === final.text) send('delta', { text: final.text.slice(shown.length) });
          const now = ctx.now();
          const base = { stepId, citations: [] as NewMessage['citations'], notInManual: false };
          const userMsg: NewMessage = { ...base, id: randomUUID(), role: 'user', text, createdAt: askedAt };
          const botMsg: NewMessage = { ...base, id: randomUUID(), role: 'assistant', text: final.text, createdAt: Math.max(now, askedAt), citations: final.citations, notInManual: final.notInManual };
          await insertMessages(ctx.db, owned.guide.id, owned.analysis.id, [userMsg, botMsg]);
          send('done', { message: messageView(botMsg) });
        } catch (e) {
          if (abort.signal.aborted) return;
          if (e instanceof AIProviderError) {
            console.warn(`[assistant] guide ${owned.guide.id}: provider error ${e.code}`);
            send('error', { error: { code: 'ai_unavailable', message: 'The assistant could not finish that answer. Please try again.' } });
          } else {
            console.error('[assistant] unexpected error', e);
            send('error', { error: { code: 'internal', message: 'Something went wrong on our side. Please try again.' } });
          }
        } finally {
          clearTimeout(timer);
          gate.release();
          if (open) {
            open = false;
            try {
              controller.close();
            } catch {
              /* already closed by the client */
            }
          }
        }
      })();
    },
    cancel() {
      stopAll();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
    },
  });
}

// --- simplify -------------------------------------------------------------------------------------

/** "Explain it more simply" for one step. Cached per analysis and step; never adds quantities (see `simplifyStepChecked`). */
export async function simplifyStep(ctx: AppContext, session: SessionInfo, rawId: string, stepId: string): Promise<Response> {
  const owned = await ownedGuide(ctx, session, rawId);
  const guide = readStoredGuide(owned);
  const step = stepId.length <= 100 ? getOwn(guide.steps, stepId) : undefined;
  if (!step) throw notFound('That step');
  const cached = await getSimplification(ctx.db, owned.analysis.id, step.id, SIMPLER_LEVEL);
  if (cached !== undefined) return json({ text: cached, cached: true, fellBack: false });

  await hitOrThrow(ctx, `assistant:simplify:${session.sessionId}`, SIMPLIFY_LIMIT);
  let result;
  try {
    result = await simplifyStepChecked(providerFor(ctx), { guide, stepId: step.id, level: 'simpler' }); // builds the simplify prompt itself
  } catch (e) {
    if (e instanceof AIProviderError) throw new ApiError('ai_unavailable', 'The simpler explanation is not available right now. Please try again.', 503);
    throw e;
  }
  if (result.fellBack) {
    console.warn(`[assistant] guide ${owned.guide.id} step ${step.id}: simplification rejected (${result.introduced.join(', ') || 'empty'})`);
    return json({ text: result.text, cached: false, fellBack: true });
  }
  await saveSimplification(ctx.db, owned.analysis.id, step.id, SIMPLER_LEVEL, result.text);
  return json({ text: result.text, cached: false, fellBack: false });
}
