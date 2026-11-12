import fixture from '../../../fixtures/lumen-bookcase.guide.json';
import manifest from '../../../fixtures/manifest.json';
import { buildDemoDraft } from './demo-guide';
import { getOwn, orderedSteps } from '../guide/selectors';
import { containsQuantity, validateGuide, type ValidatedGuide } from '../guide/validate';
import type { Part, Step } from '../guide/schema';
import {
  AIProviderError,
  NOT_IN_MANUAL_TEXT,
  type AIProvider,
  type AnalysisStage,
  type AnalyseDocumentInput,
  type AnalyseDocumentResult,
  type AnswerEvent,
  type AnswerQuestionInput,
  type SimplifyStepInput,
  type SimplifyStepResult,
  type VerifyGuideInput,
  type VerifyGuideResult,
} from './provider';

export type MockOutcome = 'guide' | 'not_a_manual' | 'failure';

export interface MockProviderOptions {
  /** Total artificial delay for `analyseDocument`, spread over the stages. Default 0. */
  delayMs?: number;
  /** Delay before each streamed answer chunk. Default: `delayMs` spread over the chunks of the answer. */
  chunkDelayMs?: number;
  outcome?: MockOutcome;
  /** Draft returned for outcome `guide`. Defaults to the Lumen bookcase fixture. */
  draft?: unknown;
}

type KnownFixture = 'lumen' | 'not_a_manual' | 'failure' | 'demo';

function knownFixture(contentHash: string): KnownFixture {
  if (contentHash === manifest.lumenBookcasePdf || contentHash === manifest.lumenBookcaseImages) return 'lumen';
  if (contentHash === manifest.notAManualPdf) return 'not_a_manual';
  if (contentHash === manifest.mockFailurePdf) return 'failure';
  return 'demo';
}

const STAGES: { stage: AnalysisStage; fraction: number; message: string }[] = [
  { stage: 'ingest', fraction: 0.1, message: 'Reading your manual' },
  { stage: 'render', fraction: 0.3, message: 'Preparing the pages' },
  { stage: 'analyse', fraction: 0.7, message: 'Working out the steps' },
  { stage: 'verify', fraction: 0.9, message: 'Checking against the pages' },
  { stage: 'publish', fraction: 1, message: 'Building your guide' },
];

export const MOCK_NOT_IN_MANUAL = NOT_IN_MANUAL_TEXT;

function abortError(): AIProviderError {
  return new AIProviderError('The request was cancelled.', 'aborted', false);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const STOP = new Set(['the', 'and', 'with', 'what', 'where', 'when', 'how', 'does', 'this', 'that', 'there', 'should', 'would', 'could', 'about', 'from', 'have', 'into', 'your', 'step', 'need', 'next', 'which', 'then', 'they', 'them', 'will']);
const words = (s: string) => (s.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w));

/** Deterministic mock: serves the fixture and keyword-matched, citation-bearing canned answers. */
export class MockProvider implements AIProvider {
  readonly name = 'mock';
  readonly isMock = true;
  private readonly opts: MockProviderOptions;

  constructor(opts: MockProviderOptions = {}) {
    this.opts = opts;
  }

  async analyseDocument(input: AnalyseDocumentInput): Promise<AnalyseDocumentResult> {
    // Without a content hash (direct calls) the mock serves the Lumen fixture. With one, it recognises its fixture
    // files and otherwise builds a labelled demo guide from the real page count.
    const known = input.contentHash === undefined ? 'lumen' : knownFixture(input.contentHash);
    const outcome = this.opts.outcome ?? (known === 'not_a_manual' ? 'not_a_manual' : known === 'failure' ? 'failure' : 'guide');
    const per = (this.opts.delayMs ?? 0) / STAGES.length;
    for (const s of STAGES) {
      await sleep(per, input.signal);
      if (outcome === 'failure' && s.stage === 'analyse') {
        throw new AIProviderError('The mock provider was told to fail.', 'provider_unavailable', true);
      }
      if (outcome === 'not_a_manual' && s.stage === 'analyse') {
        input.onProgress?.({ stage: s.stage, fraction: s.fraction, message: s.message });
        return { kind: 'not_a_manual', reason: 'This looks like a photo or document that is not an instruction manual.' };
      }
      input.onProgress?.({ stage: s.stage, fraction: s.fraction, message: s.message });
    }
    const draft = this.opts.draft ?? (known === 'demo' ? buildDemoDraft(input.pages.length) : fixture);
    return { kind: 'guide', draft: structuredClone(draft) };
  }

  async verifyGuide(input: VerifyGuideInput): Promise<VerifyGuideResult> {
    await sleep(0, input.signal);
    return { draft: structuredClone(input.guide), changes: [] };
  }

  async *answerQuestion(input: AnswerQuestionInput): AsyncIterable<AnswerEvent> {
    const { text, citations, grounded, failAfter } = this.compose(input);
    const parts = text.match(/\S+\s*/g) ?? [];
    const perChunk = this.opts.chunkDelayMs ?? (this.opts.delayMs ?? 0) / Math.max(parts.length, 1);
    let n = 0;
    for (const delta of parts) {
      if (failAfter !== undefined && n >= failAfter) throw new AIProviderError('The mock provider was told to fail mid-answer.', 'provider_unavailable', true);
      await sleep(perChunk, input.signal);
      yield { type: 'text', delta };
      n++;
    }
    yield { type: 'done', grounded, citations };
  }

  async simplifyStep(input: SimplifyStepInput): Promise<SimplifyStepResult> {
    await sleep(0, input.signal);
    const step = getOwn(input.guide.steps, input.stepId);
    if (!step) throw new AIProviderError(`Unknown step "${input.stepId}".`, 'bad_response', false);
    const sentences = step.instruction.split(/(?<=[.!?])\s+/);
    const first = sentences[0] ?? step.instruction;
    // Never drop a quantity: if later sentences carry numbers, keep the whole instruction.
    const dropped = sentences.slice(1).join(' ');
    const keepAll = input.level !== 'simplest' || containsQuantity(dropped);
    return { text: keepAll ? (input.level === 'simplest' ? step.instruction : `In short: ${step.instruction}`) : first };
  }

  private compose(input: AnswerQuestionInput): Composed {
    const raw = input.message;
    const trigger = /\[\[mock:(fail|badcite|invent|html|nocite)\]\]/.exec(raw)?.[1];
    const message = raw.replace(/\[\[mock:[a-z]+\]\]/g, ' ').trim();
    const guide = input.guide;
    const cur = (input.currentStepId ? getOwn(guide.steps, input.currentStepId) : undefined) ?? undefined;
    const cite = (step: Step, i = 0): MockCitation => {
      const src = step.sources[i] ?? step.sources[0]!;
      return { stepId: step.id, pageIndex: src.pageIndex, ...(src.region ? { region: src.region } : {}) };
    };
    const citeAll = (step: Step): MockCitation[] => step.sources.slice(0, 3).map((_, i) => cite(step, i));
    const grounded = (text: string, citations: MockCitation[]): Composed => ({ text, grounded: true, citations });

    if (trigger && cur) {
      const base = `${cur.title}: ${cur.instruction}`;
      const plain = `${cur.title} is described in the manual.`;
      if (trigger === 'fail') return { ...grounded(base, [cite(cur)]), failAfter: 3 };
      if (trigger === 'badcite') return grounded(plain, [{ stepId: 'no-such-step', pageIndex: 0 }, { stepId: cur.id, pageIndex: 999 }]);
      if (trigger === 'invent') return grounded(`${base} Tighten each screw to 47 Nm and leave the glue to dry for 3 hours.`, [cite(cur)]);
      if (trigger === 'html') return grounded('<b>Press</b> the parts in <script>alert("x")</script> <img src=x onerror=alert> & check.', [cite(cur)]);
      if (trigger === 'nocite') return grounded('This is a general comment that points at no page of the manual.', []);
    }

    const q = message.toLowerCase();
    const steps = orderedSteps(guide);
    const partsOf = (step: Step) => step.partsUsed.map((p) => guide.parts.find((x) => x.id === p.partId)).filter((p): p is Part => !!p);
    const partLabel = (p: Part) => (p.manualLabel ? `${p.name} (${p.manualLabel})` : p.name);
    const partCite = (step: Step, p: Part): MockCitation => ({ stepId: step.id, pageIndex: p.source.pageIndex, ...(p.source.region ? { region: p.source.region } : {}) });
    const mentioned = guide.parts.filter((p) => q.includes(p.name.toLowerCase()));
    const guidance = (g: NonNullable<Step['why']>) => (g.origin === 'manual' ? `${g.text} The manual says: "${g.sourceQuote}"` : `${g.text} (This is Instructor's explanation, not the manual's wording.)`);

    if (cur) {
      if (/difference|differ\b|\bvs\.?\b|compare/.test(q)) {
        const [a, b] = mentioned.length >= 2 ? mentioned : partsOf(cur);
        if (a && b) {
          const text = `${partLabel(a)} and ${partLabel(b)} are different parts in the parts list. ${[a, b].map((p) => (p.description ? `${p.name}: ${p.description}` : '')).filter(Boolean).join(' ')} The manual does not describe how they differ beyond that.`.replace(/\s+/g, ' ');
          return grounded(text, [partCite(cur, a), partCite(cur, b)]);
        }
        return { text: MOCK_NOT_IN_MANUAL, grounded: false, citations: [] };
      }
      if (/which (piece|part)|what (piece|part)|which one|what is this (piece|part)/.test(q)) {
        const parts = mentioned.length > 0 ? mentioned : partsOf(cur);
        if (parts.length === 0) return { text: MOCK_NOT_IN_MANUAL, grounded: false, citations: [] };
        const list = parts.map(partLabel).join(', ');
        return grounded(`This step uses: ${list}. The parts list in the manual shows what each part looks like; tap the page reference to see it.`, [...parts.slice(0, 3).map((p) => partCite(cur, p))]);
      }
      if (/\bwhy\b/.test(q) && !/warn/.test(q)) {
        if (cur.why) return grounded(guidance(cur.why), [cite(cur)]);
        return { text: MOCK_NOT_IN_MANUAL, grounded: false, citations: [] };
      }
      if (/warn|danger|careful|safe/.test(q)) {
        if (cur.warnings.length === 0) return { text: MOCK_NOT_IN_MANUAL, grounded: false, citations: [] };
        const text = cur.warnings.map((w) => (w.sourceQuote ? `The manual says: "${w.sourceQuote}"` : w.text)).join(' ');
        return grounded(text, [cite(cur)]);
      }
      if (/mistake|go wrong|avoid/.test(q) && cur.commonMistake) return grounded(guidance(cur.commonMistake), [cite(cur)]);
      if (/done right|know it|check(ed)? (it|this)|finished|correct/.test(q) && cur.checkpoint) return grounded(guidance(cur.checkpoint), [cite(cur)]);
      if (/what('| i)?s next|what is next|what comes next|after this|next step/.test(q)) {
        const next = steps[steps.findIndex((s) => s.id === cur.id) + 1];
        if (!next) return grounded('This is the last step of the guide, so there is nothing after it.', [cite(cur)]);
        return grounded(`Next is "${next.title}": ${next.instruction}`, [cite(cur), cite(next)]);
      }
      if (/where.*(shown|manual|page|find)|which page/.test(q)) {
        return grounded('This step is shown in the manual on the page given in the reference below. Tap it to open the page.', citeAll(cur));
      }
      if (/what does (this|the) step mean|what (do|should) i do|explain (this|the) step|what is this step|what am i doing/.test(q)) {
        return grounded(`${cur.title}: ${cur.instruction}`, citeAll(cur));
      }
    }

    // Free-form questions: the best keyword match across the guide, quoting the manual's own wording.
    const qw = new Set(words(message));
    let best: { step: Step; score: number } | undefined;
    for (const step of steps) {
      const hay = new Set(words([step.title, step.instruction, ...step.warnings.map((w) => w.text), ...partsOf(step).map((p) => p.name)].join(' ')));
      let score = 0;
      for (const w of qw) if (hay.has(w)) score += 1;
      if (score === 0) continue;
      if (step.id === input.currentStepId) score += 0.5;
      if (!best || score > best.score) best = { step, score };
    }
    if (!best) return { text: MOCK_NOT_IN_MANUAL, grounded: false, citations: [] };
    const { step } = best;
    const warn = step.warnings[0]?.sourceQuote ? ` The manual says: "${step.warnings[0].sourceQuote}"` : '';
    return grounded(`${step.title}: ${step.instruction}${warn}`, [cite(step)]);
  }
}

type MockCitation = { stepId: string; pageIndex: number; region?: Step['sources'][number]['region'] };
interface Composed {
  text: string;
  grounded: boolean;
  citations: MockCitation[];
  /** Throw after this many chunks (test trigger). */
  failAfter?: number;
}

/** Page count of the bundled fixture manual. */
export const FIXTURE_PAGE_COUNT = 6;

/** The bundled fixture, run through `validateGuide`. Throws if the fixture ever stops validating. */
export function loadFixtureGuide(): ValidatedGuide {
  const r = validateGuide(structuredClone(fixture), { pageCount: FIXTURE_PAGE_COUNT });
  if (!r.ok) throw new Error(`Bundled fixture guide is invalid: ${r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  return r.guide;
}
