import fixture from '../../../fixtures/lumen-bookcase.guide.json';
import manifest from '../../../fixtures/manifest.json';
import { buildDemoDraft } from './demo-guide';
import { getOwn, orderedSteps } from '../guide/selectors';
import { containsQuantity, validateGuide, type ValidatedGuide } from '../guide/validate';
import type { Step } from '../guide/schema';
import {
  AIProviderError,
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
  /** Delay before each streamed answer chunk. Default 0. */
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

export const MOCK_NOT_IN_MANUAL = 'That is not in your manual, so I cannot answer it from here. Check the manufacturer or the printed leaflet rather than relying on a guess.';

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
    const { text, citations, grounded } = this.compose(input);
    const parts = text.match(/\S+\s*/g) ?? [];
    for (const delta of parts) {
      await sleep(this.opts.chunkDelayMs ?? 0, input.signal);
      yield { type: 'text', delta };
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

  private compose(input: AnswerQuestionInput): { text: string; grounded: boolean; citations: { stepId: string; pageIndex: number; region?: Step['sources'][number]['region'] }[] } {
    const q = new Set(words(input.message));
    const guide = input.guide;
    let best: { step: Step; score: number } | undefined;
    for (const step of orderedSteps(guide)) {
      const hay = new Set(words([step.title, step.instruction, ...step.warnings.map((w) => w.text), ...step.partsUsed.map((p) => guide.parts.find((x) => x.id === p.partId)?.name ?? '')].join(' ')));
      let score = 0;
      for (const w of q) if (hay.has(w)) score += 1;
      if (score === 0) continue;
      if (step.id === input.currentStepId) score += 0.5;
      if (!best || score > best.score) best = { step, score };
    }
    if (!best) return { text: MOCK_NOT_IN_MANUAL, grounded: false, citations: [] };
    const { step } = best;
    const src = step.sources[0]!;
    const warn = step.warnings[0]?.sourceQuote ? ` The manual says: "${step.warnings[0].sourceQuote}"` : '';
    return {
      text: `${step.title}: ${step.instruction}${warn}`,
      grounded: true,
      citations: [{ stepId: step.id, pageIndex: src.pageIndex, ...(src.region ? { region: src.region } : {}) }],
    };
  }
}

/** Page count of the bundled fixture manual. */
export const FIXTURE_PAGE_COUNT = 6;

/** The bundled fixture, run through `validateGuide`. Throws if the fixture ever stops validating. */
export function loadFixtureGuide(): ValidatedGuide {
  const r = validateGuide(structuredClone(fixture), { pageCount: FIXTURE_PAGE_COUNT });
  if (!r.ok) throw new Error(`Bundled fixture guide is invalid: ${r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  return r.guide;
}
