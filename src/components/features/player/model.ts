// Pure logic of the Step player: which step is shown, labels, ordering of warnings, read-aloud script.
// Everything here works on ValidatedGuide-shaped data via the shared selectors.

import type { Part, Phase, Step, Warning } from '@/lib/guide/schema';
import { getOwn, orderedSteps, partsForStep, phaseForStep } from '@/lib/guide/selectors';
import type { ValidatedGuide } from '@/lib/guide/validate';
import { normaliseQuote } from '@/components/ui';

export type StepNotice = 'unknown-step' | 'updated-guide' | null;

export interface Resolved {
  stepId: string;
  notice: StepNotice;
  /** Every step is marked done: the player opens in review mode. */
  review: boolean;
}

/**
 * Which step to show (USER_FLOWS 6.6, 10.5). The URL wins when it names a real step; otherwise the saved step;
 * a saved step that no longer exists falls back to the first step not done.
 */
export function resolveStep(
  guide: ValidatedGuide,
  urlStep: string | null,
  saved: { currentStepId: string | null; completedStepIds: readonly string[] },
): Resolved {
  const steps = orderedSteps(guide);
  const first = steps[0]!;
  const done = new Set(saved.completedStepIds);
  const review = steps.length > 0 && steps.every((s) => done.has(s.id));
  const exists = (id: string | null): id is string => !!id && !!getOwn(guide.steps, id);
  const firstNotDone = () => steps.find((s) => !done.has(s.id)) ?? first;

  if (exists(urlStep)) return { stepId: urlStep, notice: null, review };
  if (!urlStep && review) return { stepId: first.id, notice: null, review };
  const savedOk = exists(saved.currentStepId);
  if (urlStep) {
    // ?step names nothing in this guide.
    return { stepId: savedOk ? saved.currentStepId! : firstNotDone().id, notice: 'unknown-step', review };
  }
  if (savedOk) return { stepId: saved.currentStepId!, notice: null, review };
  if (saved.currentStepId) return { stepId: firstNotDone().id, notice: 'updated-guide', review };
  // Nothing saved yet: start at the first step not done.
  return { stepId: firstNotDone().id, notice: null, review };
}

export const NOTICE_TEXT: Record<Exclude<StepNotice, null>, string> = {
  'unknown-step': "That step isn't in this guide - showing where you left off.",
  'updated-guide': 'We updated this guide - check where you are.',
};

export interface StepPosition {
  /** 0-based. */
  index: number;
  /** 1-based, for display. */
  number: number;
  total: number;
  prev: Step | null;
  next: Step | null;
  phase: Phase | undefined;
}

export function stepPosition(guide: ValidatedGuide, stepId: string): StepPosition {
  const steps = orderedSteps(guide);
  const index = Math.max(0, steps.findIndex((s) => s.id === stepId));
  return {
    index,
    number: index + 1,
    total: steps.length,
    prev: steps[index - 1] ?? null,
    next: steps[index + 1] ?? null,
    phase: phaseForStep(guide, stepId),
  };
}

export type PrimaryKind = 'complete' | 'complete-last' | 'irreversible' | 'next' | 'finish';

/** What the single large button does and says (USER_FLOWS 6.2, 6.5). Only this button completes a step. */
export function primaryAction(step: Step, isDone: boolean, isLast: boolean): { kind: PrimaryKind; label: string } {
  if (isDone) return isLast ? { kind: 'finish', label: 'Finish' } : { kind: 'next', label: 'Next step' };
  if (step.irreversible) return { kind: 'irreversible', label: 'I checked - done' };
  return isLast ? { kind: 'complete-last', label: 'Done - finish' } : { kind: 'complete', label: 'Done - next step' };
}

/** Warnings with severity `warning` before `caution`, manual order inside each group; never dropped. */
export function sortedWarnings(warnings: readonly Warning[]): Warning[] {
  const rank = (w: Warning) => (w.severity === 'caution' ? 1 : 0);
  return warnings.map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i).map((x) => x.w);
}

export interface MissingPartUse {
  part: Part;
  quantity?: number;
}

/** Parts of this step that the user marked missing in prep. */
export function missingPartsForStep(guide: ValidatedGuide, stepId: string, checklist: Readonly<Record<string, string>>): MissingPartUse[] {
  return partsForStep(guide, stepId)
    .filter((sp) => getOwn(checklist as Record<string, string>, sp.part.id) === 'missing')
    .map((sp) => ({ part: sp.part, quantity: sp.quantity }));
}

/** "You marked Cam lock (B) as missing. This step needs 4." (USER_FLOWS 10.4) */
export function missingPartSentence(m: MissingPartUse): string {
  const name = m.part.manualLabel ? `${m.part.name} (${m.part.manualLabel})` : m.part.name;
  return `You marked ${name} as missing.${m.quantity ? ` This step needs ${m.quantity}.` : ' This step needs it.'}`;
}

/** Steps (1-based number) with their flags for the rail. */
export interface RailStep {
  step: Step;
  number: number;
  done: boolean;
  irreversible: boolean;
  lowConfidence: boolean;
  missingPart: boolean;
}
export interface RailGroup {
  phase: Phase;
  steps: RailStep[];
  doneCount: number;
}

export function railGroups(
  guide: ValidatedGuide,
  completed: readonly string[],
  checklist: Readonly<Record<string, string>>,
): RailGroup[] {
  const done = new Set(completed);
  const missing = new Set(Object.entries(checklist).filter(([, v]) => v === 'missing').map(([k]) => k));
  const index = new Map(orderedSteps(guide).map((s, i) => [s.id, i + 1]));
  return guide.phases.map((phase) => {
    const steps: RailStep[] = [];
    for (const id of phase.stepIds) {
      const step = getOwn(guide.steps, id);
      if (!step) continue;
      steps.push({
        step,
        number: index.get(id) ?? 0,
        done: done.has(id),
        irreversible: step.irreversible,
        lowConfidence: step.confidence === 'low',
        missingPart: step.partsUsed.some((p) => missing.has(p.partId)),
      });
    }
    return { phase, steps, doneCount: steps.filter((s) => s.done).length };
  });
}

/** Segments for the progress bar: one per phase, width by step count. */
export const progressPhases = (groups: RailGroup[]) => groups.map((g) => ({ steps: g.steps.length }));

/**
 * What read-aloud says, in order (USER_FLOWS 6.4): the irreversible notice, every warning (its quote too when
 * it differs), the title, the instruction, then the checkpoint.
 */
export function readAloudScript(step: Step): string[] {
  const out: string[] = [];
  if (step.irreversible) out.push("Careful: this step can't be undone.");
  for (const w of sortedWarnings(step.warnings)) {
    out.push(`${w.severity === 'caution' ? 'Caution' : 'Warning'}: ${w.text}`);
    if (w.sourceQuote && normaliseQuote(w.sourceQuote) !== normaliseQuote(w.text)) out.push(`The manual says: ${w.sourceQuote}`);
  }
  out.push(step.title, step.instruction);
  if (step.checkpoint) out.push(`You'll know it's right when ${step.checkpoint.text}`);
  return out.filter((s) => s.trim().length > 0);
}

/** Notice shown on the step before an irreversible one. */
export const nextIsIrreversible = (next: Step | null) => !!next?.irreversible;

/** Step number label: "Step 7 of 24: Attach the side panel". */
export const announceStep = (pos: StepPosition, title: string) => `Step ${pos.number} of ${pos.total}: ${title}`;

/** Page (0-based) a step's Original viewer should open on. */
export function stepOriginalPage(step: Step): number {
  return step.sources[0]?.pageIndex ?? 0;
}
