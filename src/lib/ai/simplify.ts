import { getOwn } from '../guide/selectors';
import { findIntroducedQuantities } from '../guide/validate';
import type { AIProvider, SimplifyStepInput } from './provider';

export interface CheckedSimplification {
  /** Text safe to show: the simplification, or the original instruction if the check rejected it. */
  text: string;
  /** True when the provider's text was rejected and the original instruction is returned instead. */
  fellBack: boolean;
  /** Quantities the rejected text introduced (for logging and for telling the user). */
  introduced: string[];
}

/**
 * Asks the provider to simplify a step, but never lets a number or quantity that is not in the original
 * instruction through (measurements must come from the manual). On rejection the original text is returned.
 */
export async function simplifyStepChecked(provider: AIProvider, input: SimplifyStepInput): Promise<CheckedSimplification> {
  const step = getOwn(input.guide.steps, input.stepId);
  const original = step?.instruction ?? '';
  const { text } = await provider.simplifyStep(input);
  const introduced = findIntroducedQuantities(original, text);
  if (introduced.length > 0 || !text.trim()) return { text: original, fellBack: true, introduced };
  return { text, fellBack: false, introduced: [] };
}
