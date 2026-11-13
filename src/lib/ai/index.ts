import Anthropic from '@anthropic-ai/sdk';
import { loadAIConfig } from '../config';
import { AnthropicProvider, type AnthropicProviderOptions } from './anthropic';
import { MockProvider, type MockProviderOptions } from './mock';
import type { AIProvider } from './provider';

export * from './provider';
export { MockProvider, MOCK_NOT_IN_MANUAL, loadFixtureGuide, FIXTURE_PAGE_COUNT, type MockProviderOptions, type MockOutcome } from './mock';
export { AnthropicProvider, MemoryUsageSink, priceUsage, HAIKU_5_5_RATES, type AnthropicProviderOptions, type UsageSink, type UsageRecord, type PricingRates } from './anthropic';
export { simplifyStepChecked, type CheckedSimplification } from './simplify';

/**
 * Chooses the provider from `AI_PROVIDER` (default `mock`). `anthropic` needs ANTHROPIC_API_KEY and throws a ConfigError
 * at startup without it; the key is read only through `loadAIConfig` and never logged. Models default to claude-haiku-5-5
 * (D-025) and can be set per role by env. `anthropicOptions` lets the accuracy harness inject a usage sink or a client.
 */
export function getAIProvider(
  env: Record<string, string | undefined> = process.env,
  mockOptions?: MockProviderOptions,
  anthropicOptions?: Partial<AnthropicProviderOptions>,
): AIProvider {
  const name = (env.AI_PROVIDER ?? 'mock').trim().toLowerCase() || 'mock';
  if (name === 'mock') return new MockProvider(mockOptions);
  if (name === 'anthropic') {
    const cfg = loadAIConfig(env);
    return new AnthropicProvider({
      client: anthropicOptions?.client ?? new Anthropic({ apiKey: cfg.apiKey, maxRetries: 2 }),
      models: cfg.models,
      chunkPages: cfg.chunkPages,
      ...anthropicOptions,
    });
  }
  throw new Error(`Unknown AI_PROVIDER "${name}". Expected "mock" or "anthropic".`);
}
