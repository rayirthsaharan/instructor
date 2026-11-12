import type { Region } from '../guide/schema';
import type { ValidatedGuide } from '../guide/validate';

/** No SDK types leak through this file: implementations map to and from their own SDK internally. */

export type AnalysisStage = 'ingest' | 'render' | 'analyse' | 'verify' | 'publish';

export interface AnalysisProgress {
  stage: AnalysisStage;
  /** 0..1 within the whole analysis. */
  fraction: number;
  message?: string;
}

export interface PageImage {
  index: number;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: Uint8Array;
}

export interface AnalyseDocumentInput {
  pages: PageImage[];
  /** Hash of the uploaded content. Real providers ignore it; the mock matches it against its fixture manuals. */
  contentHash?: string;
  /** Preferred language for generated text; defaults to the manual's language. */
  language?: string;
  onProgress?: (progress: AnalysisProgress) => void;
  signal?: AbortSignal;
}

export type AnalyseDocumentResult =
  /** `draft` is untrusted model output: it must go through `validateGuide` before use. */
  | { kind: 'guide'; draft: unknown }
  | { kind: 'not_a_manual'; reason: string };

export interface VerifyGuideInput {
  guide: ValidatedGuide;
  pages: PageImage[];
  signal?: AbortSignal;
}

export interface VerifyChange {
  stepId?: string;
  kind: 'confidence_downgraded' | 'content_removed' | 'content_corrected';
  detail: string;
}

export interface VerifyGuideResult {
  /** Still untrusted: re-validate with `validateGuide`. */
  draft: unknown;
  changes: VerifyChange[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Text given to a real model: `system` holds fixed rules only; every piece of document or user text is data inside `user`. */
export interface AssistantPrompt {
  system: string;
  user: string;
}

/** The explicit "the manual does not say" answer. Shared by the mock, the guards and the UI contract. */
export const NOT_IN_MANUAL_TEXT = 'That is not in your manual, so I cannot answer it from here. Check the manufacturer or the printed leaflet rather than relying on a guess.';

export interface AnswerQuestionInput {
  guide: ValidatedGuide;
  currentStepId?: string;
  completedStepIds?: string[];
  /**
   * Assembled by `buildAssistantPrompt`. A real provider adapter must send this and nothing else: no other field of this
   * input (guide, message, history) may be put into a request. Only the deterministic mock reads the structured fields.
   */
  prompt?: AssistantPrompt;
  message: string;
  history?: ChatTurn[];
  signal?: AbortSignal;
}

export interface Citation {
  stepId: string;
  pageIndex: number;
  region?: Region;
}

export type AnswerEvent =
  | { type: 'text'; delta: string }
  /** `grounded: false` means the manual does not cover the question; citations are then empty. */
  | { type: 'done'; grounded: boolean; citations: Citation[] };

export type SimplifyLevel = 'simpler' | 'simplest';

export interface SimplifyStepInput {
  guide: ValidatedGuide;
  stepId: string;
  level: SimplifyLevel;
  /** Assembled by `buildSimplifyPrompt`. A real provider adapter sends this and nothing else; the mock reads the step itself. */
  prompt?: AssistantPrompt;
  signal?: AbortSignal;
}

export interface SimplifyStepResult {
  /** Replaces the instruction only. Warnings are never simplified and are shown verbatim alongside. */
  text: string;
}

export type AIErrorCode = 'provider_unavailable' | 'rate_limited' | 'bad_response' | 'aborted' | 'unknown';

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly code: AIErrorCode,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

export interface AIProvider {
  readonly name: string;
  /** Shared rows from the mock must never be reused across sessions (ARCHITECTURE section 10, item 2). */
  readonly isMock: boolean;
  analyseDocument(input: AnalyseDocumentInput): Promise<AnalyseDocumentResult>;
  verifyGuide(input: VerifyGuideInput): Promise<VerifyGuideResult>;
  answerQuestion(input: AnswerQuestionInput): AsyncIterable<AnswerEvent>;
  simplifyStep(input: SimplifyStepInput): Promise<SimplifyStepResult>;
}
