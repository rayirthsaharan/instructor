import type { AnthropicLike } from '../../src/lib/ai/anthropic';
import type { ModelGuide } from '../../src/lib/ai/anthropic/schemas';

export interface FakeCall {
  kind: 'stream' | 'create' | 'countTokens';
  params: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  options?: { signal?: AbortSignal };
}

export interface FakeMessage {
  content: { type: 'text'; text: string }[];
  stop_reason?: string;
  stop_details?: { category?: string | null } | null;
  usage?: Record<string, number | null>;
}

export function textMessage(text: string, extra: Partial<FakeMessage> = {}): FakeMessage {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...extra };
}

/** Fake SDK client: each call takes the next scripted response (a message, or an Error to throw). */
export function fakeClient(script: (FakeMessage | Error | ((call: FakeCall) => FakeMessage | Error))[], opts: { deltas?: string[] } = {}) {
  const calls: FakeCall[] = [];
  let i = 0;
  const next = (call: FakeCall) => {
    calls.push(call);
    let r = script[Math.min(i++, script.length - 1)]!;
    if (typeof r === 'function') r = r(call);
    return r;
  };
  const client = {
    messages: {
      create: async (params: any, options?: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const r = next({ kind: 'create', params, options });
        if (r instanceof Error) throw r;
        return r;
      },
      countTokens: async (params: any, options?: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        calls.push({ kind: 'countTokens', params, options });
        return { input_tokens: 1234 };
      },
      stream: (params: any, options?: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const r = next({ kind: 'stream', params, options });
        let aborted = false;
        const text = r instanceof Error ? '' : r.content.map((b) => b.text).join('');
        const deltas = opts.deltas ?? (text ? [text] : []);
        return {
          abort: () => { aborted = true; void aborted; },
          async *[Symbol.asyncIterator]() {
            if (r instanceof Error) throw r;
            for (const d of deltas) yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: d } };
          },
          finalMessage: async () => {
            if (r instanceof Error) throw r;
            return r;
          },
        };
      },
    },
  } as unknown as AnthropicLike;
  return { client, calls };
}

export function modelGuide(prefixHint = 's', over: Partial<ModelGuide> = {}): ModelGuide {
  const src = { pageIndex: 0, regionFallback: false };
  return {
    schemaVersion: 1,
    language: 'en',
    title: 'Shelf',
    summary: 'Build a shelf.',
    category: 'furniture',
    difficulty: 1,
    peopleNeeded: 1,
    safetyCritical: false,
    tools: [{ id: 't1', name: 'Screwdriver', included: false }],
    parts: [{ id: 'p1', name: 'Panel A', source: src }],
    phases: [{ id: 'ph1', title: 'Build', stepIds: [`${prefixHint}1`, `${prefixHint}2`] }],
    steps: [1, 2].map((n) => ({
      id: `${prefixHint}${n}`,
      phaseId: 'ph1',
      title: `Step ${n}`,
      instruction: `Do thing ${n} with the panel.`,
      partsUsed: [{ partId: 'p1' }],
      toolsUsed: ['t1'],
      warnings: [],
      irreversible: false,
      confidence: 'high' as const,
      interpretedFromDiagram: false,
      sources: [{ ...src, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }],
      highlights: [{ source: src, partId: 'p1' }],
    })),
    glossary: [],
    unreadablePages: [],
    ...over,
  };
}
