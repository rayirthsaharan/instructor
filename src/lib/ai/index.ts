import { MockProvider, type MockProviderOptions } from './mock';
import type { AIProvider } from './provider';

export * from './provider';
export { MockProvider, MOCK_NOT_IN_MANUAL, loadFixtureGuide, FIXTURE_PAGE_COUNT, type MockProviderOptions, type MockOutcome } from './mock';
export { simplifyStepChecked, type CheckedSimplification } from './simplify';

/**
 * Chooses the provider from `AI_PROVIDER` (default `mock`). The real provider is not implemented yet and
 * must not be reachable by accident, so asking for it fails loudly.
 */
export function getAIProvider(env: Record<string, string | undefined> = process.env, mockOptions?: MockProviderOptions): AIProvider {
  const name = (env.AI_PROVIDER ?? 'mock').trim().toLowerCase() || 'mock';
  if (name === 'mock') return new MockProvider(mockOptions);
  if (name === 'anthropic') {
    throw new Error('AI_PROVIDER=anthropic is not implemented yet. Use AI_PROVIDER=mock; real analysis needs approval and an API key (D-006).');
  }
  throw new Error(`Unknown AI_PROVIDER "${name}". Expected "mock" or "anthropic".`);
}
