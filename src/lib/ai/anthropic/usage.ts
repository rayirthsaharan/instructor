/** Token usage of one model call and its cost, so the accuracy harness can enforce its spend cap (D-025: $10). */

export type UsageCallType = 'analyse' | 'reconcile' | 'verify' | 'answer' | 'simplify' | 'count_tokens';

export interface UsageRecord {
  callType: UsageCallType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Receives one record per model call. Must not throw; failures are swallowed by the provider. */
export interface UsageSink {
  record(usage: UsageRecord): void;
}

/** Collects records in memory; `totalCost` prices them. */
export class MemoryUsageSink implements UsageSink {
  readonly records: UsageRecord[] = [];
  record(usage: UsageRecord): void {
    this.records.push(usage);
  }
  totalCost(rates: PricingRates = HAIKU_5_5_RATES): number {
    return this.records.reduce((sum, r) => sum + priceUsage(r, rates), 0);
  }
}

/** USD per million tokens. */
export interface PricingRates {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
  /** Rates used when the whole prompt (uncached + cache read + cache write) is above `longPromptThreshold` tokens. */
  longPrompt?: { inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok: number; cacheWritePerMTok: number };
  longPromptThreshold?: number;
}

/**
 * Claude Haiku 5.5 as listed in the claude-api skill (checked 2026-11-13): $0.10 / $0.50 per MTok for prompts up to
 * 100K tokens, $0.50 / $2.50 above that; cache reads are 0.1x input, 5-minute cache writes 1.25x input.
 * Override through `AnthropicProviderOptions.rates` if prices change.
 */
export const HAIKU_5_5_RATES: PricingRates = {
  inputPerMTok: 0.1,
  outputPerMTok: 0.5,
  cacheReadPerMTok: 0.01,
  cacheWritePerMTok: 0.125,
  longPrompt: { inputPerMTok: 0.5, outputPerMTok: 2.5, cacheReadPerMTok: 0.05, cacheWritePerMTok: 0.625 },
  longPromptThreshold: 100_000,
};

/** Pure: cost in USD of one call. */
export function priceUsage(usage: Pick<UsageRecord, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>, rates: PricingRates = HAIKU_5_5_RATES): number {
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const r = rates.longPrompt && rates.longPromptThreshold !== undefined && promptTokens > rates.longPromptThreshold ? rates.longPrompt : rates;
  return (
    (usage.inputTokens * r.inputPerMTok + usage.outputTokens * r.outputPerMTok + usage.cacheReadTokens * r.cacheReadPerMTok + usage.cacheWriteTokens * r.cacheWritePerMTok) /
    1_000_000
  );
}

interface SdkUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function usageFromSdk(callType: UsageCallType, model: string, usage: SdkUsageLike | null | undefined): UsageRecord {
  return {
    callType,
    model,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}
