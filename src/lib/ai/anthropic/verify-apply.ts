import type { Guide, Step } from '../../guide/schema';
import { findIntroducedQuantities } from '../../guide/quantity';
import type { VerifyChange } from '../provider';
import type { VerifyOutput } from './schemas';

type Review = VerifyOutput['reviews'][number];
type DraftGuide = Omit<Guide, 'steps'> & { steps: Record<string, Step> };

const RANK = { low: 0, medium: 1, high: 2 } as const;

function clip(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * Applies model reviews deterministically. The model can only lower confidence, correct an instruction without
 * introducing any quantity that is not in the original instruction or the step's quotes, drop inferred guidance, or
 * mark a step unsupported (which removes it, unless it is the last step; then it is flagged low confidence).
 * Steps without a review are left exactly as they were. The result still goes through `validateGuide`.
 */
export function applyReviews(guide: DraftGuide, reviews: readonly Review[]): { draft: DraftGuide; changes: VerifyChange[] } {
  const changes: VerifyChange[] = [];
  const steps: Record<string, Step> = { ...guide.steps };
  const removed = new Set<string>();
  const seen = new Set<string>();
  const remaining = () => Object.keys(steps).length - removed.size;

  for (const r of reviews) {
    const original = steps[r.stepId];
    if (!original || seen.has(r.stepId)) continue;
    seen.add(r.stepId);
    let step: Step = original;

    if (r.verdict === 'unsupported' && remaining() > 1) {
      removed.add(r.stepId);
      changes.push({ stepId: r.stepId, kind: 'content_removed', detail: `Removed because the manual pages do not support it: ${clip(r.reason)}` });
      continue;
    }
    let confidence = r.verdict === 'unsupported' ? 'low' : r.confidence;

    if (r.verdict === 'corrected' && r.correctedInstruction && r.correctedInstruction.trim() !== '' && r.correctedInstruction.trim() !== step.instruction.trim()) {
      const evidence = [step.instruction, step.sourceQuote ?? '', ...step.warnings.map((w) => w.sourceQuote ?? ''), step.checkpoint?.sourceQuote ?? ''];
      const introduced = findIntroducedQuantities(evidence, r.correctedInstruction);
      if (introduced.length === 0) {
        step = { ...step, instruction: r.correctedInstruction.trim() };
        changes.push({ stepId: r.stepId, kind: 'content_corrected', detail: clip(r.reason) });
      } else {
        confidence = 'low';
        changes.push({ stepId: r.stepId, kind: 'confidence_downgraded', detail: `A correction was proposed but not applied because it introduced ${introduced.join(', ')}; please check this step against the manual.` });
      }
    }
    for (const field of r.unsupportedInferred ?? []) {
      if (step[field] && step[field]!.origin === 'inferred') {
        const { [field]: _gone, ...rest } = step;
        void _gone;
        step = rest as Step;
        changes.push({ stepId: r.stepId, kind: 'content_removed', detail: `Removed ${field}: ${clip(r.reason)}` });
      }
    }
    if (RANK[confidence] < RANK[step.confidence]) {
      changes.push({ stepId: r.stepId, kind: 'confidence_downgraded', detail: clip(r.reason) });
      step = { ...step, confidence };
    }
    steps[r.stepId] = step;
  }

  if (removed.size === 0) return { draft: { ...guide, steps }, changes };
  for (const id of removed) delete steps[id];
  const phases = guide.phases
    .map((p) => ({ ...p, stepIds: p.stepIds.filter((id) => !removed.has(id)) }))
    .filter((p) => p.stepIds.length > 0);
  return { draft: { ...guide, steps, phases }, changes };
}
