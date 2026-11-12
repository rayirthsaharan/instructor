import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as postDocument } from '@/app/api/documents/route';
import { GET as getDoc } from '@/app/api/documents/[id]/route';
import { GET as listRoute, POST as askRoute } from '@/app/api/guides/[id]/messages/route';
import { POST as simplifyRoute } from '@/app/api/guides/[id]/steps/[stepId]/simplify/route';
import { MockProvider, NOT_IN_MANUAL_TEXT, loadFixtureGuide, simplifyStepChecked, type AIProvider } from '@/lib/ai';
import { finalizeAnswer } from '@/lib/assistant/guard';
import { QuantityHoldback } from '@/lib/assistant/holdback';
import { createTestApp, fixture, TestClient, uploadForm, type TestApp } from './helpers/app';

/* eslint-disable @typescript-eslint/no-explicit-any -- parsed JSON from the API */
const guide = loadFixtureGuide();
const pageCount = 6;
const finalize = (stepId: string, text: string, extraCites: string[] = []) => {
  const ids = [stepId, ...extraCites];
  return finalizeAnswer({
    guide,
    pageCount,
    text,
    grounded: true,
    citations: ids.map((id) => ({ stepId: id, pageIndex: guide.steps[id]!.sources[0]!.pageIndex })),
  });
};

describe('QA M3 A: legitimate answers must not be rejected (false positives)', () => {
  // [step, answer]. Every sentence only restates what the step says or is ordinary connecting English; none adds a fact.
  const legit: [string, string][] = [
    ['s1', 'Check each part against the parts list and keep the small fittings together in a bowl so none get lost.'],
    ['s2', 'The dowels go into the top edge of each side panel. They line up the top panel so it cannot slip sideways.'],
    ['s2', 'Press each dowel in straight. Pushing it in at an angle can split the panel edge.'],
    ['s2', 'Press 4 dowels into the top edge of each side panel, 8 in total.'],
    ['s3', 'The cam bolts go on the inner face of each side panel at the marked holes. Use the Phillips screwdriver.'],
    ['s4', 'Press a cam lock into each round hole at the ends of the shelves and match the direction in the diagram.'],
    ['s5', 'Work on the carton or a soft cloth so the panels are not scratched.'],
    ['s6', 'Fit the second side panel over the shelves, then lower the top panel onto the dowels.'],
    ['s7', 'Nail the back panel on using 16 nails spaced evenly along every edge. You cannot take it off again without damaging it.'],
    ['s8', 'You need a second person to help you tip the bookcase upright.'],
    ['s8', 'Two adults are needed to stand the bookcase upright.'],
    ['s9', 'Pull the strap tight and fix it to a wall stud or wall anchor.'],
    ['s10', 'Do not load more than 15 kg per shelf.'],
    ['s10', 'Do not load more than 15 kilograms on each shelf.'],
  ];
  // Everyday English that a good answer will contain. Each is a false positive if rejected.
  const everyday: [string, string, string][] = [
    ['one of the', 's2', 'Dowels are one of the parts that keep the top panel from slipping.'],
    ['one side', 's2', 'Do the dowels in the top edge of one side panel first, then the other.'],
    ['both sides', 's2', 'Both side panels get dowels in the top edge.'],
    ['once', 's6', 'Once the shelves are on, fit the second side panel over them.'],
    ['single', 's7', 'Do not leave a single edge without nails.'],
    ['minute', 's8', 'Take a minute to clear the floor before you tip it upright.'],
    ['step N in prose', 's6', 'The dowels from step 2 are what the top panel lowers onto.'],
    ['step N in prose, same step', 's2', 'This is step 2, where the dowels go in.'],
    ['first', 's5', 'Join the shelves to the first side before the second.'],
    ['I as roman', 's9', 'Part I is the wall strap kit.'],
  ];
  // Rarer false positives: reported, not asserted.
  const rarer: [string, string, string][] = [
    ['pair', 's1', 'Pair each part with the matching entry in the parts list.'],
    ['day', 's9', 'Check the strap is still tight every day.'],
    ['foot', 's10', 'Stand at the foot of the bookcase when you check the cam locks.'],
    ['pound', 's7', 'Do not pound the nails; tap them in.'],
    ['degree', 's6', 'Check that all edges are flush to a high degree.'],
    ['few', 's1', 'Keep the few small fittings together in a bowl.'],
    ['dot-less sentence join', 's2', 'Press the dowels in.Then continue.'],
  ];

  it.each(legit)('accepts the restated answer for %s: %s', (step, text) => {
    const r = finalize(step, text);
    expect(r.notInManual, `${text} -> ${r.issues.map((i) => i.message).join('; ')}`).toBe(false);
  });

  it.each(everyday)('accepts everyday English: %s', (_n, step, text) => {
    const r = finalize(step, text);
    expect(r.notInManual, `${text} -> ${r.issues.map((i) => i.message).join('; ')}`).toBe(false);
  });

  it('reports the rejection rate of the legitimate corpus (informational)', () => {
    const rejectedLegit = legit.filter(([s, t]) => finalize(s, t).notInManual).length;
    const rejectedEveryday = everyday.filter(([, s, t]) => finalize(s, t).notInManual).length;
    console.info(`[qa-m3] restated fixture answers rejected: ${rejectedLegit}/${legit.length}; everyday-English answers rejected: ${rejectedEveryday}/${everyday.length}`);
    const rejectedRarer = rarer.filter(([, s, t]) => finalize(s, t).notInManual).map(([n]) => n);
    console.info(`[qa-m3] rarer everyday words rejected: ${rejectedRarer.length}/${rarer.length} (${rejectedRarer.join(', ')})`);
    expect(rejectedLegit).toBe(0);
  });
});

describe('QA M3 A: invented quantities that must be rejected', () => {
  // Each is an invented count, size or ordinal for step s2 ("Press 4 dowels (G) ... top edge of each side panel (A)").
  const must: [string, string][] = [
    ['digits', 'Press 6 dowels in.'],
    ['right number, wrong unit', 'Press the dowels in with 4 Nm of force.'],
    ['spelled number', 'Press nine dowels in.'],
    ['teen', 'Press fourteen dowels in.'],
    ['compound', 'Press twenty-one dowels in.'],
    ['ordinal', 'Press the dowel into the seventh hole.'],
    ['ordinal 2', 'Press the dowels in the tenth minute.'],
    ['lowercase roman numeral', 'Press xii dowels in.'],
    ['accented number word', 'Press fiv\u00e9 dowels in.'],
    ['all-Cyrillic look-alike of six', 'Press \u0455\u0456\u0445 dowels in.'],
    ['fullwidth digits', 'Press \uff16 dowels in.'],
    ['superscript digit', 'Press the dowels in by 5\u00b2.'],
    ['circled digit', 'Press \u2465 dowels in.'],
    ['keycap emoji', 'Press 7\ufe0f\u20e3 dowels in.'],
    ['percentage', 'Press the dowels in 50% of the way.'],
    ['telephone', 'Call 0800 123 456 for spare dowels.'],
    ['year', 'This design dates from 1998.'],
    ['version', 'Use revision B3.'],
    ['time unit word only', 'Wait an hour.'],
    ['temperature unit', 'Keep it at room temperature of 20 degrees Celsius.'],
  ];
  const soft: [string, string][] = [
    ['million', 'There are a million dowels.'],
    ['small caps', 'Press \u1d1b\u1d07\u0274 dowels in.'],
    ['halfway', 'Press the dowels in halfway.'],
    ['x multiplier', 'Press the dowels in x2.'],
    ['twofold', 'Press the dowels in twofold.'],
    ['ton', 'It weighs a ton.'],
    ['[at]/[dot] email', 'Email help [at] acme [dot] example.'],
    ['spelled-out domain', 'See acme dot example for help.'],
  ];
  it('rarer bypasses (informational)', () => {
    const accepted = soft.filter(([, t]) => !finalize('s2', t).notInManual).map(([n]) => n);
    console.info(`[qa-m3] rarer invented-quantity or address spellings accepted: ${accepted.join(', ') || 'none'}`);
  });
  it.each(must)('rejects: %s', (_n, text) => {
    const r = finalize('s2', text);
    expect(r.notInManual, text).toBe(true);
    expect(r.text).toBe(NOT_IN_MANUAL_TEXT);
    expect(r.citations).toEqual([]);
  });
});

describe('QA M3 A: number bound to its own unit and step', () => {
  it('the cited step s8 says "Two adults": "Two kg" and "2 screws" are not the same quantity', () => {
    expect(finalize('s8', 'Two adults are needed.').notInManual).toBe(false);
    expect(finalize('s8', 'Two kg are needed.').notInManual).toBe(true);
  });
  it('16 nails (s7) is not valid when only s2 is cited, even with the right unit', () => {
    expect(finalize('s7', 'Use 16 nails.').notInManual).toBe(false);
    expect(finalize('s2', 'Use 16 nails.').notInManual).toBe(true);
  });
  it('15 kg of s10 does not make 15 nails valid, nor 15 g', () => {
    expect(finalize('s10', 'Load 15 kg per shelf.').notInManual).toBe(false);
    expect(finalize('s10', 'Load 15 nails per shelf.').notInManual).toBe(true);
    expect(finalize('s10', 'Load 15 g per shelf.').notInManual).toBe(true);
    expect(finalize('s10', 'Load 15 lb per shelf.').notInManual).toBe(true);
  });
  it('a fourth cited step does not widen the evidence', () => {
    expect(finalize('s1', 'Use 16 nails.', ['s2', 's3', 's7']).notInManual).toBe(true);
    expect(finalize('s1', 'Use 16 nails.', ['s2', 's7']).notInManual).toBe(false);
  });
  it('a number only in the part list of an uncited step is rejected', () => {
    expect(finalize('s1', 'You need 8 dowels.').notInManual).toBe(true);
    expect(finalize('s2', 'You need 8 dowels.').notInManual).toBe(false);
  });
});

describe('QA M3 A: web and email addresses', () => {
  const bad = [
    'See https://acme.example/support for help.',
    'Email help@acme.example for help.',
    'Visit www.acme.example.',
    'Go to acme.support/help.',
    'See acme\uff0eexample for help.',
    'See ACME.EXAMPLE for help.',
    'See hxxp://acme.example for help.',
    'Open ftp://acme.example/file.',
    'See ac\u200bme.ex\u200bample.',
  ];
  it.each(bad)('rejects an address that is not in the manual: %s', (text) => {
    expect(finalize('s2', text).notInManual, text).toBe(true);
  });
});

describe('QA M3 A: streaming hold-back never shows an unverified quantity or address', () => {
  const drip = (text: string, size: number) => {
    const h = new QuantityHoldback(false);
    let shown = '';
    for (let i = 0; i < text.length; i += size) shown += h.push(text.slice(i, i + size));
    return shown;
  };
  const risky = [
    'Press 4 dowels in.',
    'Press ten dowels in.',
    'Press fi\u200bve dowels in.',
    'Press tw\u043e dowels in.',
    'Press XII dowels in.',
    'Press an inch deep.',
    'Press\u00a0five\u00a0dowels\u00a0in.',
    'Press\u2003five dowels in.',
    'Email help@acme.example now.',
    'See www.acme.example now.',
    'See https://acme.example now.',
    'Press 4mm dowels in.',
    'Press \uff14 dowels in.',
  ];
  for (const size of [1, 2, 3, 7]) {
    it.each(risky)(`chunk size ${size}: nothing risky is released before the end: %s`, (text) => {
      const shown = drip(text + ' ', size);
      expect(shown).not.toMatch(/\d|\uff14|ten|five|fi\u200bve|tw\u043e|XII|inch|@|www\.|https?:/);
    });
  }
});

describe('QA M3: assistant routes with a stub provider', () => {
  let app: TestApp;
  beforeEach(() => {
    app = createTestApp();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    app.close();
  });
  const withAnswer = (answerQuestion: AIProvider['answerQuestion']): AIProvider => Object.assign(Object.create(new MockProvider()) as AIProvider, { answerQuestion });
  async function newGuide(c = new TestClient()) {
    const up = await c.call(postDocument, '/api/documents', { method: 'POST', body: uploadForm({ data: fixture('lumen-bookcase.pdf') }) });
    const { documentId } = await up.json();
    await app.drain();
    const st = await (await c.call(getDoc, '/x', {}, { id: documentId })).json();
    return { c, guideId: st.guideId as string };
  }
  const ask = (c: TestClient, guideId: string, text: string, stepId = 's2', signal?: AbortSignal) =>
    c.call(askRoute, `/api/guides/${guideId}/messages`, { method: 'POST', body: JSON.stringify({ stepId, text }), signal }, { id: guideId });
  const events = async (res: Response) =>
    (await res.text()).split('\n\n').filter(Boolean).map((b) => ({ event: /^event: (.*)$/m.exec(b)![1]!, data: JSON.parse(/^data: (.*)$/m.exec(b)![1]!) }));
  const stored = async (c: TestClient, guideId: string) => (await (await c.call(listRoute, '/x', {}, { id: guideId })).json()).messages as any[];

  it('a client that disconnects mid-stream stops the provider, frees the stream slot and stores nothing', async () => {
    const { c, guideId } = await newGuide();
    let providerSignal: AbortSignal | undefined;
    app.ctx.provider = withAnswer(async function* (i) {
      providerSignal = i.signal;
      for (;;) {
        yield { type: 'text', delta: 'Press ' };
        await new Promise((r) => setTimeout(r, 5));
      }
    });
    const ac = new AbortController();
    const res = await ask(c, guideId, 'hello', 's2', ac.signal);
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await vi.waitFor(() => expect(providerSignal?.aborted).toBe(true));
    app.ctx.provider = new MockProvider();
    const again = await ask(c, guideId, 'What does this step mean?');
    expect(again.status, 'slot must be free after a disconnect').toBe(200);
    expect((await events(again)).at(-1)!.event).toBe('done');
    expect(await stored(c, guideId)).toHaveLength(2);
  });

  it('cancelling the response body (what a browser Stop does) frees the slot', async () => {
    const { c, guideId } = await newGuide();
    app.ctx.provider = withAnswer(async function* () {
      for (;;) {
        yield { type: 'text', delta: 'Press ' };
        await new Promise((r) => setTimeout(r, 5));
      }
    });
    const res = await ask(c, guideId, 'hello');
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    app.ctx.provider = new MockProvider();
    await vi.waitFor(async () => expect((await ask(c, guideId, 'What is next?', 's3').then(async (r) => (r.status === 200 ? (await r.text(), 200) : r.status)))).toBe(200));
    expect(await stored(c, guideId)).toHaveLength(2);
  });

  it('a provider that throws before the first token ends in error, stores nothing and frees the slot', async () => {
    const { c, guideId } = await newGuide();
    app.ctx.provider = withAnswer(async function* () {
      throw new Error('boom: secret internal detail');
      yield { type: 'text', delta: '' };
    });
    const res = await ask(c, guideId, 'hello');
    const raw = await res.text();
    expect(raw).toContain('event: error');
    expect(raw).not.toContain('secret internal detail');
    expect(await stored(c, guideId)).toEqual([]);
    app.ctx.provider = new MockProvider();
    expect((await ask(c, guideId, 'What does this step mean?')).status).toBe(200);
  });

  it('what is streamed before `done` never contains unverified numbers, units or addresses (stub model)', async () => {
    const { c, guideId } = await newGuide();
    const answers: [string, string[]][] = [
      ['Press 6 dowels in, about 12 mm deep. ', ['Press ', '6 dowels', ' in, about 12', ' mm deep. ']],
      ['Press the dowels in. Tighten to ten Nm. Email help@acme.example. ', ['Press the dowels in. Tig', 'hten to te', 'n Nm. Email help@ac', 'me.example. ']],
      ['Press the dowels in, then wait a minute or two. ', ['Press the dowels in, then wait a mi', 'nute or tw', 'o. ']],
      ['Press the dowels in with \u0661\u0662 units. ', ['Press the dowels in with \u0661', '\u0662 units. ']],
    ];
    for (const [full, parts] of answers) {
      app.ctx.assistantLimits = { messages: { limit: 1000, windowMs: 60_000 }, maxStreams: 8 };
      app.ctx.provider = withAnswer(async function* () {
        for (const p of parts) yield { type: 'text', delta: p };
        yield { type: 'done', grounded: true, citations: [{ stepId: 's2', pageIndex: 2 }] };
      });
      const evs = await events(await ask(c, guideId, 'hello'));
      const streamed = evs.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
      expect(streamed, full).not.toMatch(/\d|\u0661|\u0662|help@|\bten\b|\btw\b|minute|two|\bmm\b/);
      expect(evs.at(-1)!.data.message, full).toMatchObject({ text: NOT_IN_MANUAL_TEXT, notInManual: true, citations: [] });
    }
  });

  it('plain text only: markup, links and bidi/zero-width/control characters in an answer are stored and sent as inert text', async () => {
    const { c, guideId } = await newGuide();
    app.ctx.provider = withAnswer(async function* () {
      yield { type: 'text', delta: 'Press the <b>dowels</b> in [click](javascript:alert\u200b()) \u202egnirts\u202c <img src=x onerror=alert()> now.\u0007' };
      yield { type: 'done', grounded: true, citations: [{ stepId: 's2', pageIndex: 2 }] };
    });
    const evs = await events(await ask(c, guideId, 'hello'));
    const msg = evs.at(-1)!.data.message;
    expect(msg.text).not.toMatch(/[\u202e\u202c\u200b\u0007]/);
    // The tag text is data. It must be returned as text with the tags still visible to a person, not stripped silently into other content.
    expect(msg.text).toContain('<b>dowels</b>');
    const [, assistant] = await stored(c, guideId);
    expect(assistant.text).toBe(msg.text);
  });

  it('look-alike step ids and prototype keys in the citation list never become chips', async () => {
    const { c, guideId } = await newGuide();
    app.ctx.provider = withAnswer(async function* () {
      yield { type: 'text', delta: 'Press the dowels in.' };
      yield { type: 'done', grounded: true, citations: [{ stepId: '__proto__', pageIndex: 2 }, { stepId: 'constructor', pageIndex: 2 }, { stepId: 's2', pageIndex: 99 }, { stepId: 's2', pageIndex: -1 }, { stepId: 's2', pageIndex: 1.5 }] as any };
    });
    const evs = await events(await ask(c, guideId, 'hello'));
    expect(evs.at(-1)!.data.message).toMatchObject({ text: NOT_IN_MANUAL_TEXT, notInManual: true, citations: [] });
  });

  it('an unhandled error in the provider constructor of the stream leaves no stuck slot (two quick asks in a row)', async () => {
    const { c, guideId } = await newGuide();
    for (let i = 0; i < 3; i++) {
      const r = await ask(c, guideId, `What does this step mean? ${i}`);
      expect(r.status).toBe(200);
      await r.text();
    }
    expect(await stored(c, guideId)).toHaveLength(6);
  });
});

describe('QA M3 E: "Explain it more simply" guard', () => {
  const step = guide.steps.s2!;
  const prov = (text: unknown): AIProvider => Object.assign(Object.create(new MockProvider()) as AIProvider, { simplifyStep: async () => ({ text }) });
  const input = { guide, stepId: 's2', level: 'simpler' as const };

  it.each([
    ['digits', 'Push 6 dowels in.'],
    ['spelled', 'Push five dowels in.'],
    ['ordinal', 'Push dowels into the seventh hole.'],
    ['address', 'Push 4 dowels in, see acme.example/help.'],
    ['unit-less quantity word', 'Push in several dowels.'],
  ])('rejects a simplification that adds a quantity: %s', async (_n, text) => {
    expect((await simplifyStepChecked(prov(text), input)).fellBack, text).toBe(true);
  });

  it('accepts a plain restatement and keeps the number', async () => {
    const r = await simplifyStepChecked(prov('Push 4 dowels into the top edge of each side panel.'), input);
    expect(r).toMatchObject({ fellBack: false });
  });

  it('accepts everyday simpler wording ("one" and "both" are not new facts)', async () => {
    for (const text of ['Push 4 dowels into the top edge of both side panels.', 'Put 4 dowels in the top edge of one side panel, then the other.']) {
      const r = await simplifyStepChecked(prov(text), input);
      expect(r.fellBack, text).toBe(false);
    }
  });

  it('the fallback is the unchanged original instruction', async () => {
    const r = await simplifyStepChecked(prov('Push 6 dowels in.'), input);
    expect(r.text).toBe(step.instruction);
  });
});

describe('QA M3 E: simplify route', () => {
  let app: TestApp;
  beforeEach(() => {
    app = createTestApp();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    app.close();
  });
  it('a rejected simplification is not cached; a later good one is, and a cache hit never calls the provider', async () => {
    const c = new TestClient();
    const up = await c.call(postDocument, '/api/documents', { method: 'POST', body: uploadForm({ data: fixture('lumen-bookcase.pdf') }) });
    const { documentId } = await up.json();
    await app.drain();
    const guideId = (await (await c.call(getDoc, '/x', {}, { id: documentId })).json()).guideId as string;
    let calls = 0;
    let reply = 'Push 6 dowels in.';
    app.ctx.provider = Object.assign(Object.create(new MockProvider()) as AIProvider, {
      simplifyStep: async () => {
        calls++;
        return { text: reply };
      },
    });
    const post = () => c.call(simplifyRoute, '/x', { method: 'POST' }, { id: guideId, stepId: 's2' });
    const first = await (await post()).json();
    expect(first).toMatchObject({ fellBack: true, cached: false, text: guide.steps.s2!.instruction });
    reply = 'Push 4 dowels into the top edge of each side panel.';
    const second = await (await post()).json();
    expect(second).toMatchObject({ fellBack: false, cached: false });
    const third = await (await post()).json();
    expect(third).toMatchObject({ fellBack: false, cached: true, text: second.text });
    expect(calls).toBe(2);
    app.ctx.provider = Object.assign(Object.create(new MockProvider()) as AIProvider, {
      simplifyStep: async () => {
        throw new Error('must not be called');
      },
    });
    expect((await (await post()).json()).cached).toBe(true);
  });
});

describe('QA M3 re-check: D-022 calibration', () => {
  const rej = (step: string, t: string) => finalize(step, t).notInManual;
  it.each([
    'Wait an hour.', 'Take an inch.', 'Use a litre.', 'Press the dowel into the seventh hole.', 'Press the third hole.', 'Press xii dowels.',
    'Press fivé dowels.', 'Press ѕіх dowels.', 'Press 五 dowels.', 'Use one inch.', 'Wait zero minutes.', 'Press two screws.', 'Press four screws in.', 'See step 42.',
  ])('still rejected: %s', (t) => expect(rej('s2', t), t).toBe(true));
  it.each([
    'Check every day.', 'Do not pound the nails.', 'Press the first hole, then the second.', 'Press 4 dowels.', 'Press four dowels in.',
    'Use one of the dowels, on both sides, once, a single one.', 'Take a minute to check.', 'Keep a few spare.',
  ])('accepted: %s', (t) => expect(rej('s2', t), t).toBe(false));
  it('"step N" only for a real step number', () => {
    expect(rej('s6', 'See step 2 for the dowels.')).toBe(false);
    expect(rej('s6', 'See step 11.')).toBe(true);
  });
  it('"pair" is an ordinary word (D-022 item 2)', () => {
    expect(rej('s1', 'Pair each part with the matching entry in the parts list.')).toBe(false);
    expect(rej('s1', 'Keep a pair of hands free.')).toBe(false);
  });
  it('legitimate answers stream progressively and hold only from the number on', () => {
    const h = new QuantityHoldback(false);
    const shown: string[] = [];
    for (const p of ['Press the dowels in straight. ', 'Pushing at an angle can split ', 'the panel edge, so use 4 ', 'dowels. Then check them. ']) shown.push(h.push(p));
    expect(shown[0]).toContain('Press the dowels in straight.');
    expect(shown[1]).toContain('Pushing at an angle');
    expect(shown.join('')).not.toMatch(/\d|dowels\. Then/);
  });
  it('rarer-word false-positive rate after D-022 (informational)', () => {
    const rarer = ['Pair each part with the entry.', 'Check the strap every day.', 'Stand at the foot of the bookcase.', 'Do not pound the nails.', 'Keep the few small fittings together.'];
    const bad = rarer.filter((t) => rej('s1', t));
    console.info(`[qa-m3] D-022 rarer words rejected: ${bad.length}/${rarer.length} ${bad.join(' | ')}`);
  });
});
