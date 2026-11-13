import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAIProvider, MockProvider, MOCK_NOT_IN_MANUAL, loadFixtureGuide, AIProviderError, type AnswerEvent, type AnalysisProgress } from '@/lib/ai';
import { validateGuide } from '@/lib/guide/validate';

const input = { pages: [] };
async function collect(it: AsyncIterable<AnswerEvent>) {
  const events: AnswerEvent[] = [];
  for await (const e of it) events.push(e);
  const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
  const done = events.at(-1);
  if (done?.type !== 'done') throw new Error('no done event');
  return { text, done, events };
}

describe('MockProvider.analyseDocument', () => {
  it('returns a draft that validates', async () => {
    const res = await new MockProvider().analyseDocument(input);
    expect(res.kind).toBe('guide');
    if (res.kind !== 'guide') return;
    expect(validateGuide(res.draft, { pageCount: 6 }).ok).toBe(true);
  });
  it('returns an independent copy each time', async () => {
    const p = new MockProvider();
    const a = await p.analyseDocument(input);
    const b = await p.analyseDocument(input);
    expect(a).not.toBe(b);
    if (a.kind === 'guide' && b.kind === 'guide') expect(a.draft).not.toBe(b.draft);
  });
  it('reports staged progress in order, ending at 1', async () => {
    const seen: AnalysisProgress[] = [];
    await new MockProvider().analyseDocument({ ...input, onProgress: (p) => seen.push(p) });
    expect(seen.map((p) => p.stage)).toEqual(['ingest', 'render', 'analyse', 'verify', 'publish']);
    expect(seen.map((p) => p.fraction)).toEqual([...seen.map((p) => p.fraction)].sort((a, b) => a - b));
    expect(seen.at(-1)!.fraction).toBe(1);
  });
  it('honours the artificial delay', async () => {
    vi.useFakeTimers();
    let finished = false;
    const p = new MockProvider({ delayMs: 1000 }).analyseDocument(input).then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(500);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    await p;
    expect(finished).toBe(true);
    vi.useRealTimers();
  });
  it('can say the document is not a manual', async () => {
    const res = await new MockProvider({ outcome: 'not_a_manual' }).analyseDocument(input);
    expect(res).toMatchObject({ kind: 'not_a_manual' });
  });
  it('can fail with a retryable typed error', async () => {
    const err = await new MockProvider({ outcome: 'failure' }).analyseDocument(input).catch((e) => e);
    expect(err).toBeInstanceOf(AIProviderError);
    expect(err).toMatchObject({ code: 'provider_unavailable', retryable: true });
  });
  it('stops when aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const err = await new MockProvider({ delayMs: 100 }).analyseDocument({ ...input, signal: ac.signal }).catch((e) => e);
    expect(err).toMatchObject({ code: 'aborted' });
  });
  it('serves a custom draft', async () => {
    const res = await new MockProvider({ draft: { custom: true } }).analyseDocument(input);
    expect(res).toEqual({ kind: 'guide', draft: { custom: true } });
  });
});

describe('MockProvider.verifyGuide / simplifyStep', () => {
  const guide = loadFixtureGuide();
  it('verify returns the guide unchanged', async () => {
    const res = await new MockProvider().verifyGuide({ guide, pages: [] });
    expect(res.draft).toEqual(guide);
    expect(res.changes).toEqual([]);
  });
  it('simplifies without touching warnings', async () => {
    const p = new MockProvider();
    const s = await p.simplifyStep({ guide, stepId: 's9', level: 'simplest' });
    expect(s.text).toBe('Fix the strap to the back of the top panel and to a wall stud or wall anchor.');
    expect((await p.simplifyStep({ guide, stepId: 's9', level: 'simpler' })).text).toContain(guide.steps.s9!.instruction);
    expect(guide.steps.s9!.warnings[0]!.sourceQuote).toBeDefined();
  });
  it('simplest never drops a quantity', async () => {
    const r = await new MockProvider().simplifyStep({ guide, stepId: 's7', level: 'simplest' });
    expect(r.text).toContain('16');
  });
  it('rejects inherited ids', async () => {
    await expect(new MockProvider().simplifyStep({ guide, stepId: 'constructor', level: 'simpler' })).rejects.toBeInstanceOf(AIProviderError);
  });
  it('rejects unknown steps', async () => {
    await expect(new MockProvider().simplifyStep({ guide, stepId: 'zz', level: 'simpler' })).rejects.toBeInstanceOf(AIProviderError);
  });
});

describe('MockProvider.answerQuestion', () => {
  const guide = loadFixtureGuide();
  const ask = (message: string, currentStepId?: string, opts = {}) => collect(new MockProvider(opts).answerQuestion({ guide, message, currentStepId }));

  it('answers a covered question with a citation', async () => {
    const { text, done } = await ask('How many dowels go in each side panel?');
    expect(done.grounded).toBe(true);
    expect(text).toContain('Press 4 dowels');
    expect(done.citations).toEqual([{ stepId: 's2', pageIndex: 2, region: guide.steps.s2!.sources[0]!.region }].map((c) => (c.region ? c : { stepId: c.stepId, pageIndex: c.pageIndex })));
  });
  it('quotes the manual warning verbatim when one applies', async () => {
    const { text, done } = await ask('Do I have to fix the wall strap?');
    expect(text).toContain('WARNING: Attach the wall strap.');
    expect(done.citations[0]).toMatchObject({ stepId: 's9', pageIndex: 5 });
  });
  it('says plainly when the manual does not cover it', async () => {
    const { text, done } = await ask('What is the warranty period and who is the manufacturer?');
    expect(text).toBe(MOCK_NOT_IN_MANUAL);
    expect(done).toMatchObject({ grounded: false, citations: [] });
  });
  it('prefers the current step when scores tie', async () => {
    const a = await ask('panel', 's6');
    const b = await ask('panel', 's7');
    expect(a.done.citations[0]!.stepId).toBe('s6');
    expect(b.done.citations[0]!.stepId).toBe('s7');
  });
  it('streams in several chunks that reassemble to the text', async () => {
    const { events, text } = await ask('Tell me about the hammer and nails for the back panel');
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(3);
    expect(text.length).toBeGreaterThan(0);
    expect(events.at(-1)!.type).toBe('done');
  });
  it('is deterministic', async () => {
    const a = await ask('cam bolts');
    const b = await ask('cam bolts');
    expect(a.events).toEqual(b.events);
  });
  it('stops streaming when aborted', async () => {
    const ac = new AbortController();
    const p = new MockProvider({ chunkDelayMs: 5 });
    const stream = p.answerQuestion({ guide, message: 'cam bolts', signal: ac.signal });
    ac.abort();
    await expect(collect(stream)).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('getAIProvider', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('defaults to the mock', () => {
    const p = getAIProvider({});
    expect(p.name).toBe('mock');
    expect(p.isMock).toBe(true);
  });
  it('reads AI_PROVIDER, case-insensitively', () => {
    expect(getAIProvider({ AI_PROVIDER: ' MOCK ' }).name).toBe('mock');
    expect(getAIProvider({ AI_PROVIDER: '' }).name).toBe('mock');
  });
  it('throws a clear startup error for anthropic without an API key', () => {
    expect(() => getAIProvider({ AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });
  it('throws for unknown providers', () => {
    expect(() => getAIProvider({ AI_PROVIDER: 'foo' })).toThrow(/Unknown AI_PROVIDER/);
  });
  it('uses process.env by default', () => {
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    expect(() => getAIProvider()).toThrow();
  });
});
