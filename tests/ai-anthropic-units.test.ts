import { describe, expect, it } from 'vitest';
import { APIConnectionError, APIUserAbortError, AuthenticationError, BadRequestError, InternalServerError, RateLimitError } from '@anthropic-ai/sdk';
import { AIProviderError } from '../src/lib/ai/provider';
import { applyPartMappings, chunkPages, mergeChunkGuides } from '../src/lib/ai/anthropic/chunking';
import { assertUsableStop, mapSdkError } from '../src/lib/ai/anthropic/errors';
import { JsonStringFieldStreamer } from '../src/lib/ai/anthropic/json-stream';
import { panelsByPage, resolvePanels } from '../src/lib/ai/anthropic/panels';
import { HAIKU_5_5_RATES, MemoryUsageSink, priceUsage } from '../src/lib/ai/anthropic/usage';
import { applyReviews } from '../src/lib/ai/anthropic/verify-apply';
import { DEFAULT_AI_MODEL, ConfigError, loadAIConfig } from '../src/lib/config';
import { modelGuide } from './helpers/anthropic-fake';

const h = new Headers();

describe('pricing', () => {
  it('prices Haiku 5.5 at the standard rate up to 100K prompt tokens', () => {
    const c = priceUsage({ inputTokens: 1_000_000 - 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, { ...HAIKU_5_5_RATES, longPromptThreshold: undefined });
    expect(c).toBeCloseTo(0.1);
    expect(priceUsage({ inputTokens: 100_000, outputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(0.01 + 0.005);
  });
  it('uses the higher rate above 100K prompt tokens, counting cache tokens', () => {
    const c = priceUsage({ inputTokens: 50_000, outputTokens: 1_000_000, cacheReadTokens: 40_000, cacheWriteTokens: 20_000 });
    expect(c).toBeCloseTo((50_000 * 0.5 + 1_000_000 * 2.5 + 40_000 * 0.05 + 20_000 * 0.625) / 1e6);
  });
  it('prices cache reads at 0.1x and writes at 1.25x input', () => {
    expect(priceUsage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 50_000, cacheWriteTokens: 0 })).toBeCloseTo(0.0005);
    expect(priceUsage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 50_000 })).toBeCloseTo(0.00625);
  });
  it('accepts custom rates and sums a sink', () => {
    const sink = new MemoryUsageSink();
    const u = { callType: 'answer' as const, model: 'm', inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0 };
    sink.record(u);
    sink.record(u);
    expect(sink.totalCost({ inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 0, cacheWritePerMTok: 0 })).toBeCloseTo(6);
  });
});

describe('chunking and merge', () => {
  it('splits pages in order', () => {
    expect(chunkPages([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkPages([], 3)).toEqual([]);
  });
  it('prefixes ids per chunk, rewrites every reference and merges deterministically', () => {
    const a = modelGuide('s');
    const b = modelGuide('s', { difficulty: 3, safetyCritical: true, estimatedMinutes: 5 });
    const m = mergeChunkGuides([{ chunkIndex: 0, guide: a }, { chunkIndex: 1, guide: b }]);
    expect(Object.keys(m.steps).sort()).toEqual(['c1-s1', 'c1-s2', 'c2-s1', 'c2-s2']);
    expect(m.phases.map((p) => p.id)).toEqual(['c1-ph1', 'c2-ph1']);
    expect(m.phases[1]!.stepIds).toEqual(['c2-s1', 'c2-s2']);
    const s = m.steps['c2-s2']!;
    expect(s.phaseId).toBe('c2-ph1');
    expect(s.partsUsed[0]!.partId).toBe('c2-p1');
    expect(s.toolsUsed).toEqual(['c2-t1']);
    expect(s.highlights[0]!.partId).toBe('c2-p1');
    expect(m.difficulty).toBe(3);
    expect(m.safetyCritical).toBe(true);
    expect(m.estimatedMinutes).toBeUndefined();
    expect(JSON.stringify(mergeChunkGuides([{ chunkIndex: 0, guide: a }, { chunkIndex: 1, guide: b }]))).toBe(JSON.stringify(m));
  });
  it('rejects duplicate step ids inside one chunk', () => {
    const g = modelGuide('s');
    g.steps[1]!.id = g.steps[0]!.id;
    expect(() => mergeChunkGuides([{ chunkIndex: 0, guide: g }])).toThrow(AIProviderError);
  });
  it('applies part mappings safely', () => {
    const m = mergeChunkGuides([{ chunkIndex: 0, guide: modelGuide('s') }, { chunkIndex: 1, guide: modelGuide('s') }]);
    const r = applyPartMappings(m, [
      { keepId: 'c1-p1', duplicateIds: ['c2-p1', 'nope', 'c1-p1'] },
      { keepId: 'ghost', duplicateIds: ['c1-p1'] },
    ]);
    expect(r.parts.map((p) => p.id)).toEqual(['c1-p1']);
    expect(r.steps['c2-s1']!.partsUsed[0]!.partId).toBe('c1-p1');
    expect(applyPartMappings(m, [])).toBe(m);
  });
});

describe('panels', () => {
  const panel = { panelId: 'pg0-p2', region: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 } };
  it('takes the region from a code-detected panel the model chose', () => {
    const g = modelGuide('s');
    g.steps[0]!.sources = [{ pageIndex: 0, panelId: 'pg0-p2', region: { x: 0, y: 0, w: 1, h: 1 }, regionFallback: false }];
    const r = resolvePanels(g, panelsByPage([{ pageIndex: 0, panels: [panel] }]));
    expect(r.steps[0]!.sources[0]).toEqual({ pageIndex: 0, panelId: 'pg0-p2', region: panel.region, regionFallback: false });
  });
  it('drops invented panel ids and flags fallback; flags all refs when no panels are supplied', () => {
    const g = modelGuide('s');
    g.steps[0]!.sources = [{ pageIndex: 0, panelId: 'made-up', region: { x: 0, y: 0, w: 0.5, h: 0.5 }, regionFallback: false }];
    const withPanels = resolvePanels(g, panelsByPage([{ pageIndex: 0, panels: [panel] }]));
    expect(withPanels.steps[0]!.sources[0]).toEqual({ pageIndex: 0, region: { x: 0, y: 0, w: 0.5, h: 0.5 }, regionFallback: true });
    const none = resolvePanels(g, panelsByPage(undefined));
    expect(none.steps[0]!.sources[0]!.regionFallback).toBe(true);
    expect(none.steps[0]!.sources[0]!.panelId).toBeUndefined();
    expect(none.parts[0]!.source.regionFallback).toBe(true);
  });
});

describe('verification patches', () => {
  const base = () => mergeChunkGuides([{ chunkIndex: 0, guide: modelGuide('s') }]);
  it('only lowers confidence and reports it', () => {
    const g = base();
    g.steps['c1-s1']!.confidence = 'medium';
    const { draft, changes } = applyReviews(g, [
      { stepId: 'c1-s1', verdict: 'supported', confidence: 'high', reason: 'ok' },
      { stepId: 'c1-s2', verdict: 'supported', confidence: 'low', reason: 'blurry' },
    ]);
    expect(draft.steps['c1-s1']!.confidence).toBe('medium');
    expect(draft.steps['c1-s2']!.confidence).toBe('low');
    expect(changes).toEqual([{ stepId: 'c1-s2', kind: 'confidence_downgraded', detail: 'blurry' }]);
  });
  it('applies a correction but refuses one that introduces a quantity', () => {
    const g = base();
    const ok = applyReviews(g, [{ stepId: 'c1-s1', verdict: 'corrected', confidence: 'high', correctedInstruction: 'Attach the panel.', reason: 'wording' }]);
    expect(ok.draft.steps['c1-s1']!.instruction).toBe('Attach the panel.');
    expect(ok.changes[0]!.kind).toBe('content_corrected');
    const bad = applyReviews(g, [{ stepId: 'c1-s1', verdict: 'corrected', confidence: 'high', correctedInstruction: 'Attach the panel with 8 screws.', reason: 'x' }]);
    expect(bad.draft.steps['c1-s1']!.instruction).toBe('Do thing 1 with the panel.');
    expect(bad.draft.steps['c1-s1']!.confidence).toBe('low');
  });
  it('removes unsupported steps and empty phases, but never the last step; drops inferred guidance only', () => {
    const g = base();
    g.steps['c1-s1']!.why = { text: 'Because.', origin: 'inferred' };
    g.steps['c1-s2']!.why = { text: 'Manual says.', origin: 'manual', sourceQuote: 'q' };
    const r = applyReviews(g, [
      { stepId: 'c1-s1', verdict: 'supported', confidence: 'high', unsupportedInferred: ['why'], reason: 'r' },
      { stepId: 'c1-s2', verdict: 'supported', confidence: 'high', unsupportedInferred: ['why'], reason: 'r' },
    ]);
    expect(r.draft.steps['c1-s1']!.why).toBeUndefined();
    expect(r.draft.steps['c1-s2']!.why).toBeDefined();
    const u = applyReviews(g, [
      { stepId: 'c1-s1', verdict: 'unsupported', confidence: 'low', reason: 'absent' },
      { stepId: 'c1-s2', verdict: 'unsupported', confidence: 'low', reason: 'absent' },
    ]);
    expect(Object.keys(u.draft.steps)).toEqual(['c1-s2']);
    expect(u.draft.phases[0]!.stepIds).toEqual(['c1-s2']);
    expect(u.draft.steps['c1-s2']!.confidence).toBe('low');
  });
  it('ignores reviews of unknown steps and leaves unreviewed steps untouched', () => {
    const g = base();
    const r = applyReviews(g, [{ stepId: 'zzz', verdict: 'unsupported', confidence: 'low', reason: 'r' }]);
    expect(r.changes).toEqual([]);
    expect(r.draft.steps).toEqual(g.steps);
  });
});

describe('answer field streamer', () => {
  it('emits the answer across chunk boundaries, decoding escapes', () => {
    const json = JSON.stringify({ answer: 'Line 1\n"quoted" é 😀 end', grounded: true, citations: [] });
    for (const size of [1, 3, 7, 1000]) {
      const s = new JsonStringFieldStreamer();
      let out = '';
      for (let i = 0; i < json.length; i += size) out += s.push(json.slice(i, i + size));
      expect(out).toBe('Line 1\n"quoted" é 😀 end');
    }
  });
  it('emits nothing when the key is absent', () => {
    const s = new JsonStringFieldStreamer();
    expect(s.push('{"grounded":false}')).toBe('');
  });
});

describe('error mapping', () => {
  it('maps SDK errors to provider codes with retryability', () => {
    const cases: [unknown, string, boolean][] = [
      [new RateLimitError(429, {}, 'x', h), 'rate_limited', true],
      [new InternalServerError(529, {}, 'overloaded', h), 'provider_unavailable', true],
      [new InternalServerError(500, {}, 'x', h), 'provider_unavailable', true],
      [new AuthenticationError(401, {}, 'bad key sk-secret', h), 'provider_unavailable', false],
      [new BadRequestError(400, {}, 'x', h), 'unknown', false],
      [new APIConnectionError({ message: 'down' }), 'provider_unavailable', true],
      [new APIUserAbortError(), 'aborted', false],
      [new Error('boom'), 'unknown', false],
    ];
    for (const [err, code, retryable] of cases) {
      const m = mapSdkError(err);
      expect([m.code, m.retryable]).toEqual([code, retryable]);
      expect(m.message).not.toContain('sk-secret');
    }
    expect(mapSdkError(new Error('x'), { timedOut: true }).retryable).toBe(true);
    expect(mapSdkError(new Error('x'), { aborted: true }).code).toBe('aborted');
  });
  it('treats refusal and max_tokens as typed non-retryable errors', () => {
    expect(() => assertUsableStop({ stop_reason: 'refusal', stop_details: { category: 'cyber' } })).toThrow(/declined/);
    try { assertUsableStop({ stop_reason: 'max_tokens' }); } catch (e) { expect((e as AIProviderError).code).toBe('bad_response'); expect((e as AIProviderError).retryable).toBe(false); }
    expect(() => assertUsableStop({ stop_reason: 'end_turn' })).not.toThrow();
  });
});

describe('config', () => {
  it('defaults every role to claude-haiku-5-5 and allows overrides', () => {
    const c = loadAIConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' });
    expect(DEFAULT_AI_MODEL).toBe('claude-haiku-5-5');
    expect(c.models).toEqual({ analysis: 'claude-haiku-5-5', verify: 'claude-haiku-5-5', chat: 'claude-haiku-5-5', simplify: 'claude-haiku-5-5' });
    expect(loadAIConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', AI_MODEL_CHAT: 'custom-chat' }).models.chat).toBe('custom-chat');
  });
  it('fails clearly without a key', () => {
    expect(() => loadAIConfig({ AI_PROVIDER: 'anthropic' })).toThrow(ConfigError);
    expect(() => loadAIConfig({ AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(loadAIConfig({}).provider).toBe('mock');
  });
});
