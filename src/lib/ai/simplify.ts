import { buildSimplifyPrompt } from '../assistant/prompt';
import { cleanAnswerText, findIntroducedLinks } from '../assistant/text';
import { getOwn } from '../guide/selectors';
import { isEnglish } from '../assistant/guard';
import { hasNonLatinLetters } from '../guide/quantity';
import { findIntroducedQuantities } from '../guide/validate';
import type { AIProvider, SimplifyStepInput } from './provider';

/** A simplified instruction longer than this is rejected rather than cut. */
export const MAX_SIMPLIFIED_CHARS = 1000;

export interface CheckedSimplification {
  /** Text safe to show: the simplification, or the original instruction if the check rejected it. */
  text: string;
  /** True when the provider's text was rejected and the original instruction is returned instead. */
  fellBack: boolean;
  /** Quantities the rejected text introduced (for logging and for telling the user). */
  introduced: string[];
}

/**
 * Asks the provider to simplify a step, but never lets a number, quantity or web address that is not in the original
 * instruction through (measurements must come from the manual). The output is cleaned of control and text-direction
 * characters and must fit the length cap. On rejection the original text is returned.
 */
export async function simplifyStepChecked(provider: AIProvider, input: SimplifyStepInput): Promise<CheckedSimplification> {
  const step = getOwn(input.guide.steps, input.stepId);
  const original = step?.instruction ?? '';
  const prompt = input.prompt ?? (step ? buildSimplifyPrompt({ step, level: input.level }) : undefined);
  const { text: raw } = await provider.simplifyStep(prompt ? { ...input, prompt } : input);
  const text = cleanAnswerText(typeof raw === 'string' ? raw : '', MAX_SIMPLIFIED_CHARS + 1);
  const introduced = [...findIntroducedQuantities(original, text), ...findIntroducedLinks([original], text)];
  const foreign = isEnglish(input.guide.language) && hasNonLatinLetters(text) && !hasNonLatinLetters(original);
  if (introduced.length > 0 || foreign || !text || text.length > MAX_SIMPLIFIED_CHARS) return { text: original, fellBack: true, introduced };
  return { text, fellBack: false, introduced: [] };
}
