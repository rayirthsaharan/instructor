import type { Guide, Part, Phase, Step, Tool } from './schema';

/** Steps in manual order (phases in order, then each phase's stepIds). Unknown ids are skipped. */
export function orderedSteps(guide: Guide): Step[] {
  const out: Step[] = [];
  for (const phase of guide.phases) {
    for (const id of phase.stepIds) {
      const step = guide.steps[id];
      if (step) out.push(step);
    }
  }
  return out;
}

export function phaseForStep(guide: Guide, stepId: string): Phase | undefined {
  return guide.phases.find((p) => p.stepIds.includes(stepId));
}

export interface StepPart {
  part: Part;
  /** Quantity used in this step if stated, otherwise undefined. */
  quantity?: number;
}

/** Parts used by a step, resolved to full records. */
export function partsForStep(guide: Guide, stepId: string): StepPart[] {
  const step = guide.steps[stepId];
  if (!step) return [];
  const out: StepPart[] = [];
  for (const pu of step.partsUsed) {
    const part = guide.parts.find((p) => p.id === pu.partId);
    if (part) out.push({ part, quantity: pu.quantity });
  }
  return out;
}

export function toolsForStep(guide: Guide, stepId: string): Tool[] {
  const step = guide.steps[stepId];
  if (!step) return [];
  return step.toolsUsed.map((id) => guide.tools.find((t) => t.id === id)).filter((t): t is Tool => t !== undefined);
}

/** Steps (in manual order) that use at least one of the given missing parts. */
export function stepsBlockedByMissingParts(guide: Guide, missingPartIds: Iterable<string>): Step[] {
  const missing = new Set(missingPartIds);
  if (missing.size === 0) return [];
  return orderedSteps(guide).filter((s) => s.partsUsed.some((pu) => missing.has(pu.partId)));
}

/** Whole-number percentage (0..100) of steps completed. Unknown ids and duplicates are ignored. */
export function progressPercentage(guide: Guide, completedStepIds: Iterable<string>): number {
  const total = Object.keys(guide.steps).length;
  if (total === 0) return 0;
  const done = new Set<string>();
  for (const id of completedStepIds) if (guide.steps[id]) done.add(id);
  return Math.round((done.size / total) * 100);
}
