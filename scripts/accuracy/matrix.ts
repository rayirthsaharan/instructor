import { HAIKU_5_5_RATES, priceUsage } from '../../src/lib/ai/anthropic/usage';
import { HARD_CAP_USD } from './budget';

/**
 * Prompt variants (docs/ACCURACY_TEST_PLAN.md section 3). All use the production prompts in src/lib/ai/prompts with
 * claude-haiku-5-5 at effort `medium`; they differ only in what the harness can change through the provider's inputs
 * and options, so no paid run tests a prompt that production does not use.
 */
export interface Variant {
  id: string;
  description: string;
  /** Pass the code-detected panels (`AnalyseDocumentInput.panels`). Without them the model returns coarse regions. */
  usePanels: boolean;
  /** `AnthropicProviderOptions.chunkPages`. */
  chunkPages: number;
  repeats: number;
}

export const VARIANTS: Variant[] = [
  { id: 'panels', description: 'Production: detected panels offered by id, 12-page chunks', usePanels: true, chunkPages: 12, repeats: 3 },
  { id: 'no-panels', description: 'Control: no panels, model gives coarse regions (flagged regionFallback)', usePanels: false, chunkPages: 12, repeats: 2 },
  { id: 'panels-small-chunks', description: 'Panels offered, 6-page chunks (more attention per page)', usePanels: true, chunkPages: 6, repeats: 2 },
];

export interface MatrixRun {
  manualId: string;
  pages: number;
  variant: Variant;
  repeat: number;
}

export function buildMatrix(manuals: { id: string; pages: number }[], variants: Variant[] = VARIANTS, repeatsOverride?: number): MatrixRun[] {
  const runs: MatrixRun[] = [];
  for (const m of manuals)
    for (const v of variants)
      for (let r = 1; r <= (repeatsOverride ?? v.repeats); r++) runs.push({ manualId: m.id, pages: m.pages, variant: v, repeat: r });
  return runs;
}

/** Planning assumptions; phase 0 replaces `tokensPerPage` with the measured value per manual. */
export interface Assumptions {
  tokensPerPage: number;
  /** Fixed system prompt, schema and instructions per analysis or verify call. */
  promptOverhead: number;
  /** Panel list text per page when panels are offered. */
  panelTokensPerPage: number;
  /** Guide JSON size (in tokens) for a 12-page manual, scaled by page count. */
  guideTokensPer12Pages: number;
  /** Output per analysis call, including adaptive thinking. */
  analysisOutput: number;
  verifyOutput: number;
  reconcileInput: number;
  reconcileOutput: number;
}

export const EXPECTED: Assumptions = {
  tokensPerPage: 3_000,
  promptOverhead: 4_000,
  panelTokensPerPage: 150,
  guideTokensPer12Pages: 10_000,
  analysisOutput: 20_000,
  verifyOutput: 10_000,
  reconcileInput: 10_000,
  reconcileOutput: 3_000,
};

/** Image tokens 1.7x (high-resolution image tiers) and twice the output. */
export const WORST: Assumptions = {
  ...EXPECTED,
  tokensPerPage: 5_000,
  analysisOutput: 40_000,
  verifyOutput: 20_000,
  reconcileOutput: 6_000,
};

const cost = (input: number, output: number) => priceUsage({ inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 }, HAIKU_5_5_RATES);

/** Cost of one run (analysis of every chunk, reconcile when chunked, verification). Each call priced on its own tier. */
export function projectRunUsd(run: Pick<MatrixRun, 'pages' | 'variant'>, a: Assumptions = EXPECTED): number {
  const chunks = Math.ceil(run.pages / run.variant.chunkPages);
  const guide = Math.ceil((a.guideTokensPer12Pages * run.pages) / 12);
  let usd = 0;
  for (let c = 0; c < chunks; c++) {
    const pagesInChunk = Math.min(run.variant.chunkPages, run.pages - c * run.variant.chunkPages);
    const input = a.promptOverhead + pagesInChunk * (a.tokensPerPage + (run.variant.usePanels ? a.panelTokensPerPage : 0));
    usd += cost(input, a.analysisOutput);
    usd += cost(a.promptOverhead + pagesInChunk * a.tokensPerPage + Math.ceil(guide / chunks), a.verifyOutput);
  }
  if (chunks > 1) usd += cost(a.reconcileInput, a.reconcileOutput);
  return usd;
}

export interface Projection {
  runs: number;
  expectedUsd: number;
  worstUsd: number;
  capUsd: number;
}

export function projectMatrix(runs: MatrixRun[], capUsd = HARD_CAP_USD, measuredTokensPerPage?: Record<string, number>): Projection {
  let expectedUsd = 0;
  let worstUsd = 0;
  for (const r of runs) {
    const measured = measuredTokensPerPage?.[r.manualId];
    expectedUsd += projectRunUsd(r, measured ? { ...EXPECTED, tokensPerPage: measured } : EXPECTED);
    worstUsd += projectRunUsd(r, measured ? { ...WORST, tokensPerPage: Math.ceil(measured * 1.2) } : WORST);
  }
  return { runs: runs.length, expectedUsd, worstUsd, capUsd };
}
