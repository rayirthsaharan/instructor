/**
 * Accuracy-test CLI (docs/ACCURACY_TEST_PLAN.md). Mock mode is free and is the default:
 *
 *   npx tsx scripts/accuracy/run.ts plan
 *   npx tsx scripts/accuracy/run.ts run --manual lumen --variant all            # AI_PROVIDER=mock
 *   npx tsx scripts/accuracy/run.ts prepare --manual cyclone-x-axis            # renders data/accuracy/manuals/<id>/manual.pdf
 *   npx tsx scripts/accuracy/run.ts detect-panels --manual cyclone-x-axis      # writes panels.json (production detector)
 *   npx tsx scripts/accuracy/run.ts measure-tokens --manual all --provider anthropic   # phase 0, count_tokens only (free)
 *   npx tsx scripts/accuracy/run.ts run --manual all --variant all --provider anthropic
 *
 * Paid modes also need ACCURACY_APPROVAL=D-025 in the environment and ANTHROPIC_API_KEY from the secret settings.
 * Every request is checked by `guardedClient`: model must be claude-haiku-5-5 and its worst case must fit the cap.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MockProvider } from '../../src/lib/ai/mock';
import type { AIProvider, PageImage } from '../../src/lib/ai/provider';
import { ALLOWED_MODEL, BudgetGuard, CostLog, CostLogSink, guardedClient, HARD_CAP_USD } from './budget';
import { runMatrix } from './harness';
import { DEFAULT_DATA_DIR, detectManualPanels, loadPrepared, MANUALS, prepareManual, type LoadedManual } from './manuals';
import { buildMatrix, projectMatrix, VARIANTS, type Variant } from './matrix';

interface Args {
  command: string;
  manual: string;
  variant: string;
  repeats?: number;
  provider: 'mock' | 'anthropic';
  cap: number;
  dataDir: string;
}

function parseArgs(argv: string[]): Args {
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const provider = flag('provider') ?? 'mock';
  if (provider !== 'mock' && provider !== 'anthropic') throw new Error('--provider must be mock or anthropic');
  const cap = Number(flag('cap') ?? HARD_CAP_USD);
  const repeats = flag('repeats');
  return {
    command: argv[0] ?? 'plan',
    manual: flag('manual') ?? 'all',
    variant: flag('variant') ?? 'all',
    repeats: repeats ? Number(repeats) : undefined,
    provider,
    cap,
    dataDir: flag('data-dir') ?? DEFAULT_DATA_DIR,
  };
}

const tokensPath = (dataDir: string) => join(dataDir, 'tokens.json');

/**
 * Phase 0 arithmetic. `single[i]` = prompt + page i; `all` = prompt + every page. With n pages,
 * sum(single) - all = (n - 1) x prompt, so the prompt overhead and each page's own tokens follow exactly.
 */
export function splitTokenCounts(single: number[], all: number): { promptOverhead: number; perPage: number[]; perPageMax: number } {
  if (single.length < 2) throw new Error('Need at least two pages to separate prompt and page tokens.');
  const promptOverhead = Math.round((single.reduce((s, x) => s + x, 0) - all) / (single.length - 1));
  const perPage = single.map((x) => x - promptOverhead);
  return { promptOverhead, perPage, perPageMax: Math.max(...perPage) };
}

function readMeasured(dataDir: string): Record<string, number> | undefined {
  const p = tokensPath(dataDir);
  if (!existsSync(p)) return undefined;
  const t = JSON.parse(readFileSync(p, 'utf8')) as Record<string, { perPageMax: number }>;
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.perPageMax]));
}

function selectManualIds(a: Args): string[] {
  return a.manual === 'all' ? MANUALS.map((m) => m.id) : a.manual.split(',');
}

function selectVariants(a: Args): Variant[] {
  if (a.variant === 'all') return VARIANTS;
  const ids = a.variant.split(',');
  const out = VARIANTS.filter((v) => ids.includes(v.id));
  if (out.length !== ids.length) throw new Error(`Unknown variant in "${a.variant}". Known: ${VARIANTS.map((v) => v.id).join(', ')}`);
  return out;
}

function assertPaidAllowed(a: Args): void {
  if (process.env.ACCURACY_APPROVAL !== 'D-025') {
    throw new Error('Paid runs need ACCURACY_APPROVAL=D-025 (user approval: $10 cap, claude-haiku-5-5 only).');
  }
  if (!(a.cap > 0 && a.cap <= HARD_CAP_USD)) throw new Error(`--cap must be in (0, ${HARD_CAP_USD}]`);
}

async function realProvider(variant: Variant, guard: BudgetGuard, sink: CostLogSink): Promise<AIProvider> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { getAIProvider } = await import('../../src/lib/ai');
  const models = { analysis: ALLOWED_MODEL, verify: ALLOWED_MODEL, chat: ALLOWED_MODEL, simplify: ALLOWED_MODEL };
  // The SDK reads ANTHROPIC_API_KEY itself; the harness never reads, prints or stores the key.
  const client = guardedClient(new Anthropic({ maxRetries: 2 }), guard);
  return getAIProvider({ ...process.env, AI_PROVIDER: 'anthropic' }, undefined, { client, models, usageSink: sink, chunkPages: variant.chunkPages });
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const log = new CostLog(join(a.dataDir, 'cost-log.jsonl'));

  if (a.command === 'plan') {
    const measured = readMeasured(a.dataDir);
    const runs = buildMatrix(MANUALS.map((m) => ({ id: m.id, pages: m.pages })), selectVariants(a), a.repeats);
    const p = projectMatrix(runs, a.cap, measured);
    console.log(`Runs: ${p.runs} (each = analysis + verification). Tokens per page: ${measured ? 'measured' : 'assumed 3,000 (worst 5,000)'}.`);
    console.log(`Projected: expected $${p.expectedUsd.toFixed(2)}, worst case $${p.worstUsd.toFixed(2)}. Spent so far $${log.spentUsd().toFixed(4)} of $${a.cap.toFixed(2)}.`);
    return;
  }

  if (a.command === 'prepare') {
    for (const id of selectManualIds(a).filter((i) => i !== 'lumen')) console.log(id, await prepareManual(id, a.dataDir));
    return;
  }

  if (a.command === 'detect-panels') {
    for (const id of selectManualIds(a).filter((i) => i !== 'lumen')) {
      const r = await detectManualPanels(id, a.dataDir);
      console.log(id, r.map((p) => `${p.pageIndex + 1}:${p.panels.length}${p.method === 'none' ? '-' : p.method[0]}(${p.ms}ms)`).join(' '));
    }
    return;
  }

  const manuals: LoadedManual[] = selectManualIds(a).map((id) => loadPrepared(id, a.dataDir));
  const guard = new BudgetGuard(log, a.cap);
  const sink = new CostLogSink(log);

  if (a.command === 'measure-tokens') {
    if (a.provider !== 'anthropic') throw new Error('measure-tokens needs --provider anthropic (count_tokens is free but needs the key).');
    assertPaidAllowed(a);
    const provider = (await realProvider(VARIANTS[0]!, guard, sink)) as AIProvider & { countPageTokens?: (pages: PageImage[]) => Promise<number> };
    if (!provider.countPageTokens) throw new Error('The provider has no countPageTokens; cannot run phase 0.');
    const out: Record<string, ReturnType<typeof splitTokenCounts> & { allPages: number }> = existsSync(tokensPath(a.dataDir)) ? JSON.parse(readFileSync(tokensPath(a.dataDir), 'utf8')) : {};
    for (const m of manuals) {
      const single: number[] = [];
      for (const p of m.pages) single.push(await provider.countPageTokens([p]));
      const allPages = await provider.countPageTokens(m.pages);
      out[m.info.id] = { ...splitTokenCounts(single, allPages), allPages };
      console.log(m.info.id, out[m.info.id]);
    }
    mkdirSync(a.dataDir, { recursive: true });
    writeFileSync(tokensPath(a.dataDir), JSON.stringify(out, null, 2));
    return;
  }

  if (a.command === 'run') {
    const variants = selectVariants(a);
    const measured = readMeasured(a.dataDir);
    if (a.provider === 'anthropic') {
      assertPaidAllowed(a);
      const missing = manuals.filter((m) => !measured?.[m.info.id]).map((m) => m.info.id);
      if (missing.length > 0) throw new Error(`Run phase 0 (measure-tokens) first for: ${missing.join(', ')}`);
      const plan = projectMatrix(buildMatrix(manuals.map((m) => ({ id: m.info.id, pages: m.pages.length })), variants, a.repeats), a.cap, measured);
      guard.assertCanSpend(plan.worstUsd, `the whole matrix (worst case $${plan.worstUsd.toFixed(2)})`);
    }
    const providers = new Map<string, AIProvider>();
    if (a.provider === 'anthropic') for (const v of variants) providers.set(v.id, await realProvider(v, guard, sink));
    const batchId = new Date().toISOString().replace(/[:.]/g, '-');
    const out = await runMatrix({
      manuals,
      variants,
      repeats: a.repeats,
      providerFor: (v) => providers.get(v.id) ?? new MockProvider(),
      log,
      sink,
      guard,
      outDir: a.dataDir,
      batchId,
      measuredTokensPerPage: measured,
    });
    console.log(readFileSync(out.resultsMd, 'utf8'));
    console.log(`Results: ${out.resultsJson}`);
    if (out.stoppedForBudget) process.exitCode = 2;
    return;
  }

  throw new Error(`Unknown command "${a.command}". Use plan, prepare, detect-panels, measure-tokens or run.`);
}

const invokedDirectly = process.argv[1] !== undefined && /scripts[\\/]accuracy[\\/]run\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
