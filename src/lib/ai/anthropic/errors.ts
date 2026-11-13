import { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { AIProviderError } from '../provider';

/** Maps any error thrown while calling the SDK to a typed `AIProviderError`. Messages never include request bodies or keys. */
export function mapSdkError(err: unknown, opts: { timedOut?: boolean; aborted?: boolean } = {}): AIProviderError {
  if (err instanceof AIProviderError) return err;
  if (opts.aborted) return new AIProviderError('The analysis was cancelled.', 'aborted', false);
  if (opts.timedOut) return new AIProviderError('The AI service took too long to answer.', 'provider_unavailable', true);
  if (err instanceof APIUserAbortError) return new AIProviderError('The request was cancelled.', 'aborted', false);
  if (err instanceof APIConnectionError) return new AIProviderError('Could not reach the AI service.', 'provider_unavailable', true);
  if (err instanceof APIError) {
    const s = err.status;
    if (s === 429) return new AIProviderError('The AI service is rate limiting requests.', 'rate_limited', true);
    if (s === 401 || s === 403) return new AIProviderError('The AI service rejected the configured credentials.', 'provider_unavailable', false);
    // 529 overloaded, 5xx, request timeout, conflict
    if (s === undefined || s >= 500 || s === 408 || s === 409) return new AIProviderError(`The AI service is temporarily unavailable (${s ?? 'no status'}).`, 'provider_unavailable', true);
    return new AIProviderError(`The AI service rejected the request (${s}).`, 'unknown', false);
  }
  if (err instanceof Error && err.name === 'AbortError') return new AIProviderError('The request was cancelled.', 'aborted', false);
  return new AIProviderError('Unexpected error while calling the AI service.', 'unknown', false);
}

interface StopInfo {
  stop_reason?: string | null;
  stop_details?: { category?: string | null } | null;
}

/** Throws a typed error for stop reasons that mean the output cannot be used. */
export function assertUsableStop(message: StopInfo): void {
  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category;
    throw new AIProviderError(`The AI model declined to process this content${category ? ` (${category})` : ''}.`, 'bad_response', false);
  }
  if (message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded') {
    throw new AIProviderError('The AI model ran out of room before finishing its answer.', 'bad_response', false);
  }
}

export function badResponse(detail: string, retryable = true): AIProviderError {
  return new AIProviderError(`The AI model returned an unusable answer: ${detail}`, 'bad_response', retryable);
}
