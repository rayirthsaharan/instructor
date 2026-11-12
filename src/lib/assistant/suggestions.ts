import { orderedSteps } from '../guide/selectors';
import type { ValidatedGuide } from '../guide/validate';

/** Three short questions for a step, built only from that step's own content and fully deterministic. */
export function suggestionsForStep(guide: ValidatedGuide, stepId: string): string[] {
  const steps = orderedSteps(guide);
  const idx = steps.findIndex((s) => s.id === stepId);
  const step = steps[idx];
  if (!step) return [];
  const partNames = step.partsUsed.map((p) => guide.parts.find((x) => x.id === p.partId)?.name).filter((n): n is string => !!n);
  const candidates: (string | false | undefined)[] = [
    'What does this step mean?',
    partNames.length > 0 && 'Which piece is this?',
    step.why && 'Why am I doing this?',
    step.warnings.length > 0 && 'Why does the manual warn about this?',
    step.checkpoint && 'How do I know it is done right?',
    step.commonMistake && 'What mistake should I avoid?',
    idx < steps.length - 1 && 'What is next?',
    partNames.length > 1 && `What is the difference between the ${partNames[0]!.toLowerCase()} and the ${partNames[1]!.toLowerCase()}?`,
    'Where is this shown in the manual?',
  ];
  return candidates.filter((c): c is string => typeof c === 'string').slice(0, 3);
}
