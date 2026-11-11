import fixture from '../../../fixtures/lumen-bookcase.guide.json';
import { orderedSteps } from '../guide/selectors';
import { guideSchema, type Guide, type Step } from '../guide/schema';
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
    const outcome = this.opts.outcome ?? 'guide';
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
    return { kind: 'guide', draft: structuredClone(this.opts.draft ?? fixture) };
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
    const step = input.guide.steps[input.stepId];
    if (!step) throw new AIProviderError(`Unknown step "${input.stepId}".`, 'bad_response', false);
    const first = step.instruction.split(/(?<=[.!?])\s+/)[0] ?? step.instruction;
    return { text: input.level === 'simplest' ? first : `In short: ${step.instruction}` };
  }

  private compose(input: AnswerQuestionInput): { text: string; grounded: boolean; citations: { stepId: string; pageIndex: number; region?: Step['sources'][number]['region'] }[] } {
    const q = new Set(words(input.message));
    const guide: Guide = input.guide;
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

/** The bundled fixture, parsed and typed. Throws if the fixture ever stops matching the schema. */
export function loadFixtureGuide(): Guide {
  return guideSchema.parse(fixture);
}
