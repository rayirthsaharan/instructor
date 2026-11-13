import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AIProvider } from '../../src/lib/ai/provider';
import { validateGuide, type GuideIssue, type ValidatedGuide } from '../../src/lib/guide/validate';
import { BudgetExceededError, type BudgetGuard, type CostLog, type CostLogSink } from './budget';
import type { LoadedManual } from './manuals';
import { buildMatrix, projectRunUsd, WORST, type Variant } from './matrix';
import { passBar, scoreGuide, type ManualScore, type PanelLookup, type PassVerdict } from './score';

export type RunStatus = 'scored' | 'not_a_manual' | 'rejected_analysis' | 'rejected_verify' | 'skipped' | 'error' | 'budget_stop';

export interface RunResult {
  runId: string;
  manualId: string;
  variant: string;
  repeat: number;
  status: RunStatus;
  detail?: string;
  score?: ManualScore;
  verdict: PassVerdict;
  /** Validator issue counts by code, after verification. */
  issues: Record<string, number>;
  verifyChanges: number;
  costUsd: number;
  seconds: number;
}

export interface HarnessOptions {
  manuals: LoadedManual[];
  variants: Variant[];
  repeats?: number;
  /** A fresh provider per variant (chunk size differs). */
  providerFor: (variant: Variant) => AIProvider;
  log: CostLog;
  sink: CostLogSink;
  guard: BudgetGuard;
  outDir: string;
  /** Prefix shared by every run of this invocation. */
  batchId: string;
  measuredTokensPerPage?: Record<string, number>;
  now?: () => number;
}

export interface HarnessOutput {
  results: RunResult[];
  stoppedForBudget: boolean;
  resultsJson: string;
  resultsMd: string;
}

const countIssues = (issues: GuideIssue[]) => issues.reduce<Record<string, number>>((m, i) => ((m[i.code] = (m[i.code] ?? 0) + 1), m), {});

function panelLookup(m: LoadedManual): PanelLookup | undefined {
  return m.panels ? new Map(m.panels.map((p) => [p.pageIndex, p.panels])) : undefined;
}

/** Runs the matrix sequentially. Writes results after every run so an interrupted batch keeps what it paid for. */
export async function runMatrix(o: HarnessOptions): Promise<HarnessOutput> {
  const now = o.now ?? Date.now;
  const byId = new Map(o.manuals.map((m) => [m.info.id, m]));
  const runs = buildMatrix(
    o.manuals.map((m) => ({ id: m.info.id, pages: m.pages.length })),
    o.variants,
    o.repeats,
  );
  const results: RunResult[] = [];
  const dir = join(o.outDir, 'runs', o.batchId);
  mkdirSync(dir, { recursive: true });
  const resultsJson = join(dir, 'results.json');
  const resultsMd = join(dir, 'results.md');
  const flush = () => {
    writeFileSync(resultsJson, JSON.stringify(results, null, 2));
    writeFileSync(resultsMd, renderResults(results, o.batchId, o.log.spentUsd(), o.guard.capUsd));
  };
  const providers = new Map<string, AIProvider>();
  let stoppedForBudget = false;

  for (const run of runs) {
    const m = byId.get(run.manualId)!;
    const runId = `${o.batchId}/${run.manualId}/${run.variant.id}/${run.repeat}`;
    const base = { runId, manualId: run.manualId, variant: run.variant.id, repeat: run.repeat, issues: {}, verifyChanges: 0 };
    const spentBefore = o.log.spentUsd();
    const t0 = now();
    const finish = (r: Omit<RunResult, 'costUsd' | 'seconds'>) => {
      results.push({ ...r, costUsd: o.log.spentUsd() - spentBefore, seconds: (now() - t0) / 1000 });
      flush();
    };

    if (run.variant.usePanels && !m.panels) {
      finish({ ...base, status: 'skipped', detail: 'no panels.json for this manual (panel detector not run)', verdict: { pass: false, reasons: ['skipped'] } });
      continue;
    }
    let provider = providers.get(run.variant.id);
    if (!provider) {
      provider = o.providerFor(run.variant);
      providers.set(run.variant.id, provider);
    }
    try {
      if (!provider.isMock) {
        const measured = o.measuredTokensPerPage?.[run.manualId];
        const worst = projectRunUsd(run, measured ? { ...WORST, tokensPerPage: Math.ceil(measured * 1.2) } : WORST);
        o.guard.assertCanSpend(worst, `run ${runId}`);
      }
      o.sink.context = { runId, manualId: run.manualId, variant: run.variant.id, repeat: run.repeat };
      const pageCount = m.pages.length;
      const pageTexts = m.pageTexts.some((t) => t.trim() !== '') ? m.pageTexts : undefined;
      const analysed = await provider.analyseDocument({ pages: m.pages, ...(run.variant.usePanels && m.panels ? { panels: m.panels } : {}) });
      if (analysed.kind === 'not_a_manual') {
        finish({ ...base, status: 'not_a_manual', detail: analysed.reason, verdict: passBar(undefined) });
        continue;
      }
      const first = validateGuide(analysed.draft, { pageCount, pageTexts });
      if (!first.ok) {
        finish({ ...base, status: 'rejected_analysis', detail: first.errors.slice(0, 5).map((e) => `${e.path}: ${e.message}`).join('; '), verdict: passBar(undefined) });
        continue;
      }
      const verified = await provider.verifyGuide({ guide: first.guide, pages: m.pages });
      const second = validateGuide(verified.draft, { pageCount, pageTexts });
      if (!second.ok) {
        finish({ ...base, status: 'rejected_verify', detail: second.errors.slice(0, 5).map((e) => `${e.path}: ${e.message}`).join('; '), verdict: passBar(undefined), verifyChanges: verified.changes.length });
        continue;
      }
      const guide: ValidatedGuide = second.guide;
      const score = scoreGuide(guide, m.key, { pageTexts, panels: panelLookup(m) });
      finish({ ...base, status: 'scored', score, verdict: passBar(score), issues: countIssues(second.issues), verifyChanges: verified.changes.length });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        finish({ ...base, status: 'budget_stop', detail: err.message, verdict: { pass: false, reasons: ['budget stop'] } });
        stoppedForBudget = true;
        break;
      }
      finish({ ...base, status: 'error', detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err), verdict: { pass: false, reasons: ['error'] } });
    }
  }
  flush();
  return { results, stoppedForBudget, resultsJson, resultsMd };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Markdown results table: one row per run, then a per manual x variant summary (pass = every repeat passed). */
export function renderResults(results: RunResult[], batchId: string, spentUsd: number, capUsd: number): string {
  const lines = [
    `# Accuracy results - ${batchId}`,
    '',
    `Model: claude-haiku-5-5. Total spend to date (all batches): $${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)} cap.`,
    '',
    '| Manual | Variant | Rep | Status | Parts found | Invented parts | Qty errors | Steps mapped | Order errors | Warnings verbatim | Regions ok/coarse/approx/page/wrong/missed | Right region | Invented numbers | Cost $ | Time s | Pass |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of results) {
    const s = r.score;
    const cells = s
      ? [
          `${s.parts.matched}/${s.parts.key}`,
          String(s.parts.invented.length),
          String(s.parts.quantityErrors.length),
          `${s.steps.mapped}/${s.steps.key}`,
          String(s.steps.orderErrors),
          `${s.warnings.verbatim}/${s.warnings.key}`,
          `${s.regions.correct}/${s.regions.coarse}/${s.regions.approximate}/${s.regions.fallback}/${s.regions.wrong}/${s.regions.missed}`,
          pct(s.regions.correctShare),
          s.inventedQuantities === null ? 'n/a' : String(s.inventedQuantities.length),
        ]
      : Array<string>(9).fill('-');
    lines.push(`| ${r.manualId} | ${r.variant} | ${r.repeat} | ${r.status} | ${cells.join(' | ')} | ${r.costUsd.toFixed(4)} | ${r.seconds.toFixed(1)} | ${r.verdict.pass ? 'yes' : 'no'} |`);
  }
  const groups = new Map<string, RunResult[]>();
  for (const r of results) groups.set(`${r.manualId}|${r.variant}`, [...(groups.get(`${r.manualId}|${r.variant}`) ?? []), r]);
  lines.push('', '## Summary (a cell passes only if every repeat passed)', '', '| Manual | Variant | Runs | Passed | Worst right-region share | Cost $ |', '|---|---|---|---|---|---|');
  for (const [k, rs] of groups) {
    const [manual, variant] = k.split('|');
    const shares = rs.map((r) => r.score?.regions.correctShare ?? 0);
    lines.push(`| ${manual} | ${variant} | ${rs.length} | ${rs.every((r) => r.verdict.pass) ? 'yes' : 'no'} | ${pct(Math.min(...shares))} | ${rs.reduce((s, r) => s + r.costUsd, 0).toFixed(4)} |`);
  }
  const failures = results.filter((r) => !r.verdict.pass);
  if (failures.length > 0) {
    lines.push('', '## Why runs failed', '');
    for (const r of failures) lines.push(`- ${r.runId}: ${[...r.verdict.reasons, r.detail].filter(Boolean).join('; ')}`);
  }
  return `${lines.join('\n')}\n`;
}
