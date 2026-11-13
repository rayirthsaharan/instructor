import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicLike } from '../../src/lib/ai/anthropic';
import { HAIKU_5_5_RATES, priceUsage, type UsageRecord, type UsageSink } from '../../src/lib/ai/anthropic/usage';

/** D-025: the only model the accuracy test may call. */
export const ALLOWED_MODEL = 'claude-haiku-5-5';
/** D-025: hard cap on total spend for the whole accuracy test, across every run. */
export const HARD_CAP_USD = 10;

export interface CostEntry extends UsageRecord {
  ts: string;
  runId: string;
  manualId: string;
  variant: string;
  repeat: number;
  costUsd: number;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class ModelNotAllowedError extends Error {
  constructor(model: string) {
    super(`Model "${model}" is not approved for the accuracy test. Only ${ALLOWED_MODEL} may be called (D-025).`);
    this.name = 'ModelNotAllowedError';
  }
}

/** Append-only JSONL cost log shared by every run. The spend so far is always re-read from disk. */
export class CostLog {
  constructor(readonly path: string) {}

  entries(): CostEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as CostEntry);
  }

  spentUsd(): number {
    return this.entries().reduce((s, e) => s + e.costUsd, 0);
  }

  append(entry: CostEntry): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }
}

/** Stops before any call whose worst case would take total spend over the cap. */
export class BudgetGuard {
  constructor(
    readonly log: CostLog,
    readonly capUsd: number = HARD_CAP_USD,
  ) {
    if (!(capUsd > 0) || capUsd > HARD_CAP_USD) throw new Error(`Cap must be in (0, ${HARD_CAP_USD}] USD (D-025).`);
  }

  spentUsd(): number {
    return this.log.spentUsd();
  }

  /** Throws `BudgetExceededError` when `spent + projected > cap`. */
  assertCanSpend(projectedUsd: number, what: string): void {
    const spent = this.spentUsd();
    if (spent + projectedUsd > this.capUsd + 1e-12) {
      throw new BudgetExceededError(
        `Stopped before ${what}: spent $${spent.toFixed(4)} + projected $${projectedUsd.toFixed(4)} would exceed the $${this.capUsd.toFixed(2)} cap.`,
      );
    }
  }
}

/** Usage sink for the provider: prices each call at Haiku 5.5 list prices and appends it to the cost log. */
export class CostLogSink implements UsageSink {
  context: Pick<CostEntry, 'runId' | 'manualId' | 'variant' | 'repeat'> = { runId: '-', manualId: '-', variant: '-', repeat: 0 };

  constructor(
    private readonly log: CostLog,
    private readonly now: () => Date = () => new Date(),
  ) {}

  record(usage: UsageRecord): void {
    this.log.append({ ts: this.now().toISOString(), ...this.context, ...usage, costUsd: priceUsage(usage, HAIKU_5_5_RATES) });
  }
}

/** Worst case for one request: counted input (plus a margin for the output schema) and the full `max_tokens`. */
export function worstCaseUsd(countedInputTokens: number, maxTokens: number, inputMargin = INPUT_MARGIN): number {
  const inputTokens = Math.ceil(countedInputTokens * inputMargin.factor + inputMargin.plus);
  return priceUsage({ inputTokens, outputTokens: maxTokens, cacheReadTokens: 0, cacheWriteTokens: 0 }, HAIKU_5_5_RATES);
}

/** count_tokens does not see the structured-output schema; this margin covers it. */
export const INPUT_MARGIN = { factor: 1.05, plus: 2_000 };

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;
type StreamParams = Parameters<AnthropicLike['messages']['stream']>[0];
type CountParams = Parameters<AnthropicLike['messages']['countTokens']>[0];

function assertModel(model: string): void {
  if (model !== ALLOWED_MODEL) throw new ModelNotAllowedError(model);
}

function countParamsOf(p: StreamParams | CreateParams): CountParams {
  const out: Record<string, unknown> = { model: p.model, messages: p.messages };
  if (p.system !== undefined) out.system = p.system;
  if (p.tools !== undefined) out.tools = p.tools;
  if (p.thinking !== undefined) out.thinking = p.thinking;
  return out as unknown as CountParams;
}

/**
 * Wraps the SDK client handed to the provider. Every request is checked before it leaves the process:
 * the model must be claude-haiku-5-5, and the exact input (count_tokens, free) plus the full `max_tokens` must fit
 * under the cap. Actual spend is recorded afterwards by the provider's usage sink from each response's `usage`.
 */
export function guardedClient(inner: AnthropicLike, guard: BudgetGuard): AnthropicLike {
  const precheck = async (p: StreamParams | CreateParams, what: string, signal?: AbortSignal) => {
    assertModel(p.model);
    const counted = await inner.messages.countTokens(countParamsOf(p), signal ? { signal } : undefined);
    guard.assertCanSpend(worstCaseUsd(counted.input_tokens, p.max_tokens), what);
  };

  const messages = {
    async countTokens(params: CountParams, opts?: Parameters<AnthropicLike['messages']['countTokens']>[1]) {
      assertModel(params.model);
      return inner.messages.countTokens(params, opts);
    },
    async create(params: CreateParams, opts?: { signal?: AbortSignal }) {
      if ((params as { stream?: unknown }).stream) throw new Error('The accuracy harness does not allow create({ stream: true }); use stream().');
      await precheck(params, 'a model call', opts?.signal);
      return inner.messages.create(params, opts);
    },
    stream(params: StreamParams, opts?: { signal?: AbortSignal }) {
      // stream() is synchronous in the SDK, so the check runs lazily before the first byte is requested.
      let started: Promise<ReturnType<AnthropicLike['messages']['stream']>> | undefined;
      const start = () =>
        (started ??= precheck(params, 'a streamed model call', opts?.signal).then(() => inner.messages.stream(params, opts)));
      const lazy = {
        async *[Symbol.asyncIterator]() {
          const s = await start();
          for await (const event of s) yield event;
        },
        async finalMessage() {
          return (await start()).finalMessage();
        },
        abort() {
          void started?.then((s) => s.abort()).catch(() => undefined);
        },
      };
      return lazy as unknown as ReturnType<AnthropicLike['messages']['stream']>;
    },
  };
  return { messages: messages as unknown as AnthropicLike['messages'] };
}
