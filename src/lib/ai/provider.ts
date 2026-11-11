import type { Guide, Region } from '../guide/schema';

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
  guide: Guide;
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

export interface AnswerQuestionInput {
  guide: Guide;
  currentStepId?: string;
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
  guide: Guide;
  stepId: string;
  level: SimplifyLevel;
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
