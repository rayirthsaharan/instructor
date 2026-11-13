import type Anthropic from '@anthropic-ai/sdk';
import { AIProviderError } from './provider';
import type {
  AIProvider,
  AnalyseDocumentInput,
  AnalyseDocumentResult,
  AnswerEvent,
  AnswerQuestionInput,
  PageImage,
  SimplifyStepInput,
  SimplifyStepResult,
  VerifyGuideInput,
  VerifyGuideResult,
} from './provider';
import { getOwn } from '../guide/selectors';
import type { Guide, Step } from '../guide/schema';
import { ANALYSIS_SYSTEM_PROMPT, RECONCILE_SYSTEM_PROMPT, analysisTaskText, pageLabel, panelsBlock, reconcileTaskText } from './prompts/analysis';
import { VERIFY_SYSTEM_PROMPT, verifyTaskText } from './prompts/verify';
import { applyPartMappings, chunkPages, mergeChunkGuides } from './anthropic/chunking';
import { assertUsableStop, badResponse, mapSdkError } from './anthropic/errors';
import { JsonStringFieldStreamer } from './anthropic/json-stream';
import { panelsByPage, resolvePanels } from './anthropic/panels';
import { analysisOutputSchema, answerOutputSchema, outputFormat, partMappingSchema, verifyOutputSchema, type AnalysisOutput, type ModelGuide } from './anthropic/schemas';
import { usageFromSdk, type UsageCallType, type UsageSink } from './anthropic/usage';
import { applyReviews } from './anthropic/verify-apply';

export * from './anthropic/usage';
export { mapSdkError } from './anthropic/errors';
export { chunkPages, mergeChunkGuides, applyPartMappings, prefixChunkIds } from './anthropic/chunking';
export { applyReviews } from './anthropic/verify-apply';

/** The slice of the SDK client that the provider uses; tests inject a fake with this shape. */
export type AnthropicLike = { messages: Pick<Anthropic['messages'], 'create' | 'stream' | 'countTokens'> };

export interface AnthropicModels {
  analysis: string;
  verify: string;
  chat: string;
  simplify: string;
}

export interface AnthropicProviderOptions {
  client: AnthropicLike;
  models: AnthropicModels;
  /** Receives usage of every call, for cost accounting. */
  usageSink?: UsageSink;
  /** Pages per analysis/verification chunk. Default 12. */
  chunkPages?: number;
  /** Per-call timeouts in ms. */
  timeoutsMs?: Partial<Record<'analyse' | 'verify' | 'answer' | 'simplify' | 'count', number>>;
}

const DEFAULT_TIMEOUTS = { analyse: 600_000, verify: 600_000, answer: 90_000, simplify: 60_000, count: 30_000 };
const MAX_TOKENS = { analyse: 64_000, reconcile: 8_000, verify: 32_000, answer: 4_000, simplify: 2_000 };
const VERIFY_STEPS_PER_GROUP = 25;

type ContentBlock = Anthropic.ContentBlockParam;

function imageBlock(page: PageImage): ContentBlock {
  return { type: 'image', source: { type: 'base64', media_type: page.mimeType, data: Buffer.from(page.data).toString('base64') } };
}

function textOf(message: { content: readonly { type: string; text?: string }[] }): string {
  return message.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
}

function parseJson<T>(text: string, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, what: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw badResponse(`${what} was not valid JSON`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badResponse(`${what} did not match the expected shape`);
  return parsed.data;
}

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly isMock = false;
  private readonly client: AnthropicLike;
  private readonly models: AnthropicModels;
  private readonly sink?: UsageSink;
  private readonly chunk: number;
  private readonly timeouts: typeof DEFAULT_TIMEOUTS;

  constructor(opts: AnthropicProviderOptions) {
    this.client = opts.client;
    this.models = opts.models;
    this.sink = opts.usageSink;
    this.chunk = opts.chunkPages ?? 12;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeoutsMs };
  }

  // ---- plumbing -----------------------------------------------------------------------------------------------

  private record(callType: UsageCallType, model: string, usage: Parameters<typeof usageFromSdk>[2]): void {
    try {
      this.sink?.record(usageFromSdk(callType, model, usage));
    } catch {
      /* a failing sink must never break a paid call that already succeeded */
    }
  }

  /** Runs `fn` with a signal that fires on the caller's abort or the timeout, and maps any failure to an AIProviderError. */
  private async guarded<T>(signal: AbortSignal | undefined, timeoutMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (signal?.aborted) throw mapSdkError(null, { aborted: true });
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await fn(combined);
    } catch (err) {
      throw mapSdkError(err, { aborted: signal?.aborted === true, timedOut: timeout.aborted && signal?.aborted !== true });
    }
  }

  /** One streamed (long-running) call to completion; usage is recorded and unusable stop reasons are errors. */
  private async streamToEnd(callType: UsageCallType, model: string, params: Anthropic.MessageCreateParamsNonStreaming, signal: AbortSignal): Promise<string> {
    const { stream: _s, ...rest } = params as Anthropic.MessageCreateParamsNonStreaming & { stream?: unknown };
    void _s;
    const message = await this.client.messages.stream(rest, { signal }).finalMessage();
    this.record(callType, model, message.usage);
    assertUsableStop(message);
    return textOf(message);
  }

  // ---- analysis -----------------------------------------------------------------------------------------------

  async analyseDocument(input: AnalyseDocumentInput): Promise<AnalyseDocumentResult> {
    if (input.pages.length === 0) return { kind: 'not_a_manual', reason: 'There are no pages to read.' };
    const chunks = chunkPages(input.pages, this.chunk);
    const panels = panelsByPage(input.panels);
    const guides: { chunkIndex: number; guide: ModelGuide }[] = [];
    const skipped: { pageIndex: number; reason: string }[] = [];
    let notManualReason: string | undefined;

    for (const [i, pages] of chunks.entries()) {
      input.onProgress?.({ stage: 'analyse', fraction: i / chunks.length, message: `Reading pages ${pages[0]!.index + 1} to ${pages[pages.length - 1]!.index + 1}` });
      const out = await this.analyseChunk(pages, i, chunks.length, input);
      if (!out.isProductManual) {
        notManualReason ??= out.notManualReason;
        for (const p of pages) skipped.push({ pageIndex: p.index, reason: 'These pages did not look like part of the instructions.' });
        continue;
      }
      if (!out.guide) throw badResponse('the model said these pages are a manual but gave no guide');
      guides.push({ chunkIndex: i, guide: resolvePanels(out.guide, panels) });
    }
    if (guides.length === 0) return { kind: 'not_a_manual', reason: notManualReason ?? 'These pages do not look like an instruction manual.' };

    let draft = mergeChunkGuides(guides);
    if (skipped.length > 0) draft = { ...draft, unreadablePages: [...draft.unreadablePages, ...skipped] };
    if (guides.length > 1 && draft.parts.length > 1) {
      input.onProgress?.({ stage: 'analyse', fraction: 0.95, message: 'Matching parts across sections' });
      draft = await this.reconcileParts(draft, input.signal);
    }
    input.onProgress?.({ stage: 'analyse', fraction: 1 });
    return { kind: 'guide', draft };
  }

  private async analyseChunk(pages: PageImage[], chunkIndex: number, chunkCount: number, input: AnalyseDocumentInput): Promise<AnalysisOutput> {
    const panels = panelsByPage(input.panels);
    const content: ContentBlock[] = [];
    for (const page of pages) {
      content.push({ type: 'text', text: pageLabel(page.index) }, imageBlock(page));
      const list = panels.get(page.index);
      if (list) content.push({ type: 'text', text: panelsBlock(page.index, list) });
    }
    content.push({ type: 'text', text: analysisTaskText({ chunkIndex, chunkCount, firstPageIndex: pages[0]!.index, lastPageIndex: pages[pages.length - 1]!.index, language: input.language }) });
    const model = this.models.analysis;
    const text = await this.guarded(input.signal, this.timeouts.analyse, (signal) =>
      this.streamToEnd(
        'analyse',
        model,
        { model, max_tokens: MAX_TOKENS.analyse, system: ANALYSIS_SYSTEM_PROMPT, messages: [{ role: 'user', content }], output_config: { effort: 'medium', format: outputFormat.analysis() } },
        signal,
      ),
    );
    return parseJson(text, analysisOutputSchema, 'the analysis');
  }

  /** Model proposes which parts are duplicates; code applies the id mapping. Failures leave parts unmerged (harmless). */
  private async reconcileParts<G extends ReturnType<typeof mergeChunkGuides>>(draft: G, signal?: AbortSignal): Promise<G> {
    const model = this.models.analysis;
    const listing = draft.parts.map((p) => ({ id: p.id, name: p.name, manualLabel: p.manualLabel, description: p.description }));
    try {
      const text = await this.guarded(signal, this.timeouts.analyse, (s) =>
        this.streamToEnd(
          'reconcile',
          model,
          {
            model,
            max_tokens: MAX_TOKENS.reconcile,
            system: RECONCILE_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: [{ type: 'text', text: reconcileTaskText(listing) }] }],
            output_config: { effort: 'low', format: outputFormat.partMapping() },
          },
          s,
        ),
      );
      return applyPartMappings(draft, parseJson(text, partMappingSchema, 'the parts matching').mappings) as G;
    } catch (err) {
      if (err instanceof AIProviderError && err.code === 'aborted') throw err;
      return draft;
    }
  }

  // ---- verification -------------------------------------------------------------------------------------------

  async verifyGuide(input: VerifyGuideInput): Promise<VerifyGuideResult> {
    const guide = input.guide as Guide;
    const ordered: Step[] = guide.phases.flatMap((p) => p.stepIds).map((id) => getOwn(guide.steps, id)).filter((s): s is Step => s !== undefined);
    const pagesByIndex = new Map(input.pages.map((p) => [p.index, p] as const));
    const catalog = {
      parts: guide.parts.map((p) => ({ id: p.id, name: p.name, manualLabel: p.manualLabel, quantity: p.quantity })),
      tools: guide.tools.map((t) => ({ id: t.id, name: t.name })),
    };

    // Group consecutive steps so that each group cites at most `chunk` distinct pages.
    const groups: { steps: Step[]; pages: number[] }[] = [];
    let cur: { steps: Step[]; pages: Set<number> } | undefined;
    for (const step of ordered) {
      const stepPages = [...new Set(step.sources.map((s) => s.pageIndex))];
      const union = new Set([...(cur?.pages ?? []), ...stepPages]);
      if (!cur || union.size > this.chunk || cur.steps.length >= VERIFY_STEPS_PER_GROUP) {
        if (cur) groups.push({ steps: cur.steps, pages: [...cur.pages].sort((a, b) => a - b) });
        cur = { steps: [], pages: new Set() };
      }
      cur.steps.push(step);
      for (const p of stepPages) cur.pages.add(p);
    }
    if (cur) groups.push({ steps: cur.steps, pages: [...cur.pages].sort((a, b) => a - b) });

    const reviews: Parameters<typeof applyReviews>[1][number][] = [];
    const model = this.models.verify;
    for (const g of groups) {
      const content: ContentBlock[] = [];
      for (const idx of g.pages.slice(0, this.chunk)) {
        const page = pagesByIndex.get(idx);
        if (page) content.push({ type: 'text', text: pageLabel(idx) }, imageBlock(page));
      }
      const steps = g.steps.map((s) => ({
        id: s.id, title: s.title, instruction: s.instruction, sourceQuote: s.sourceQuote, partsUsed: s.partsUsed, toolsUsed: s.toolsUsed,
        why: s.why, commonMistake: s.commonMistake, checkpoint: s.checkpoint, warnings: s.warnings, confidence: s.confidence,
        pages: [...new Set(s.sources.map((x) => x.pageIndex))],
      }));
      content.push({ type: 'text', text: verifyTaskText({ steps, catalog }) });
      const text = await this.guarded(input.signal, this.timeouts.verify, (signal) =>
        this.streamToEnd(
          'verify',
          model,
          { model, max_tokens: MAX_TOKENS.verify, system: VERIFY_SYSTEM_PROMPT, messages: [{ role: 'user', content }], output_config: { effort: 'medium', format: outputFormat.verify() } },
          signal,
        ),
      );
      reviews.push(...parseJson(text, verifyOutputSchema, 'the verification').reviews);
    }
    const { draft, changes } = applyReviews(guide as Parameters<typeof applyReviews>[0], reviews);
    return { draft, changes };
  }

  // ---- assistant ----------------------------------------------------------------------------------------------

  async *answerQuestion(input: AnswerQuestionInput): AsyncGenerator<AnswerEvent> {
    // D-020 item 7: only the assembled prompt is sent. No other field of `input` reaches the request.
    const prompt = input.prompt;
    if (!prompt) throw new AIProviderError('The assistant prompt was not assembled.', 'unknown', false);
    if (input.signal?.aborted) throw mapSdkError(null, { aborted: true });

    // The guide JSON is the first, stable part of the user message: cache everything up to and including it.
    const marker = '</guide_data>';
    const at = prompt.user.indexOf(marker);
    const blocks: ContentBlock[] =
      at < 0
        ? [{ type: 'text', text: prompt.user }]
        : [
            { type: 'text', text: prompt.user.slice(0, at + marker.length), cache_control: { type: 'ephemeral' } },
            { type: 'text', text: prompt.user.slice(at + marker.length) },
          ];
    const model = this.models.chat;
    const timeout = AbortSignal.timeout(this.timeouts.answer);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const streamer = new JsonStringFieldStreamer('answer');
    let emitted = false;
    let stream: ReturnType<AnthropicLike['messages']['stream']> | undefined;
    try {
      stream = this.client.messages.stream(
        {
          model,
          max_tokens: MAX_TOKENS.answer,
          system: [{ type: 'text', text: prompt.system }],
          messages: [{ role: 'user', content: blocks }],
          output_config: { effort: 'medium', format: outputFormat.answer() },
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const delta = streamer.push(event.delta.text);
          if (delta) {
            emitted = true;
            yield { type: 'text', delta };
          }
        }
      }
      const message = await stream.finalMessage();
      this.record('answer', model, message.usage);
      assertUsableStop(message);
      const out = parseJson(textOf(message), answerOutputSchema, 'the answer');
      if (!emitted && out.answer) yield { type: 'text', delta: out.answer };
      yield { type: 'done', grounded: out.grounded, citations: out.grounded ? out.citations.map((c) => ({ stepId: c.stepId, pageIndex: c.pageIndex })) : [] };
    } catch (err) {
      throw mapSdkError(err, { aborted: input.signal?.aborted === true, timedOut: timeout.aborted && input.signal?.aborted !== true });
    } finally {
      stream?.abort?.();
    }
  }

  // ---- simplify -----------------------------------------------------------------------------------------------

  async simplifyStep(input: SimplifyStepInput): Promise<SimplifyStepResult> {
    const prompt = input.prompt;
    if (!prompt) throw new AIProviderError('The simplify prompt was not assembled.', 'unknown', false);
    const model = this.models.simplify;
    return this.guarded(input.signal, this.timeouts.simplify, async (signal) => {
      const message = await this.client.messages.create(
        { model, max_tokens: MAX_TOKENS.simplify, system: prompt.system, messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }], output_config: { effort: 'low' } },
        { signal },
      );
      this.record('simplify', model, message.usage);
      assertUsableStop(message);
      const text = textOf(message).trim();
      if (!text) throw badResponse('the simplified instruction was empty');
      return { text };
    });
  }

  // ---- helpers ------------------------------------------------------------------------------------------------

  /** Exact input tokens of a set of page images for the analysis model (count_tokens is free of charge). */
  async countPageTokens(pages: PageImage[], signal?: AbortSignal): Promise<number> {
    const content: ContentBlock[] = pages.flatMap((p) => [{ type: 'text' as const, text: pageLabel(p.index) }, imageBlock(p)]);
    return this.guarded(signal, this.timeouts.count, async (s) => {
      const r = await this.client.messages.countTokens({ model: this.models.analysis, system: ANALYSIS_SYSTEM_PROMPT, messages: [{ role: 'user', content }] }, { signal: s });
      return r.input_tokens;
    });
  }
}
