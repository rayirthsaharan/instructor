import { NOT_IN_MANUAL_TEXT, type Citation } from '../ai/provider';
import { getOwn } from '../guide/selectors';
import { findIntroducedQuantities, validateCitations, type GuideIssue, type ValidatedGuide } from '../guide/validate';
import type { Step } from '../guide/schema';
import { cleanAnswerText, findIntroducedLinks } from './text';

export { cleanAnswerText, cleanChunk, MAX_ANSWER_CHARS } from './text';
export const MAX_CITATIONS = 6;
/** Only the first this-many distinct cited steps count as evidence for numbers and addresses. */
export const MAX_EVIDENCE_STEPS = 3;

export interface FinalAnswer {
  text: string;
  citations: Citation[];
  notInManual: boolean;
  /** Server-side only: why anything was dropped or replaced. */
  issues: GuideIssue[];
}

/** True when the manual's language is English (or unknown), i.e. when the English number-word check can be relied on. */
export const isEnglish = (language: string | undefined): boolean => !language || /^en([-_]|$)/i.test(language.trim());

/**
 * Everything a step shows the user, one piece per field, i.e. every place a quantity in an answer may legitimately come
 * from. Pieces are checked separately so that a number in one field never combines with a unit in the next.
 */
export function stepEvidenceParts(guide: ValidatedGuide, step: Step): string[] {
  const parts: string[] = [step.title, step.instruction];
  if (step.sourceQuote) parts.push(step.sourceQuote);
  for (const w of step.warnings) parts.push(w.text, ...(w.sourceQuote ? [w.sourceQuote] : []));
  for (const f of ['why', 'commonMistake', 'checkpoint'] as const) {
    const g = step[f];
    if (g) parts.push(g.text, ...(g.sourceQuote ? [g.sourceQuote] : []));
  }
  for (const pu of step.partsUsed) {
    if (pu.quantity !== undefined) parts.push(`${pu.quantity}`);
    const part = guide.parts.find((p) => p.id === pu.partId);
    if (part) parts.push(part.name, ...(part.manualLabel ? [part.manualLabel] : []), ...(part.description ? [part.description] : []));
  }
  return parts;
}

/**
 * The last line of defence for an assistant answer: citations are validated against the guide, quantities and web
 * addresses must exist in the cited steps, and anything that cannot be verified is replaced by the fixed
 * not-in-manual answer. Model-written text reaches the user only together with at least one valid citation.
 */
export function finalizeAnswer(input: { guide: ValidatedGuide; pageCount: number; text: string; grounded: boolean; citations: readonly Citation[] }): FinalAnswer {
  const cleaned = cleanAnswerText(input.text);
  const checked = validateCitations(input.citations, input.guide, input.pageCount);
  const issues = [...checked.issues];
  const seen = new Set<string>();
  const citations = checked.citations.filter((c) => {
    const key = JSON.stringify([c.stepId, c.pageIndex, c.region ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_CITATIONS);

  const replace = (code: string, message: string): FinalAnswer => {
    issues.push({ code, path: '', severity: 'warning', message });
    return { text: NOT_IN_MANUAL_TEXT, citations: [], notInManual: true, issues };
  };

  if (!cleaned) return replace('answer_empty', 'The provider returned an empty answer.');
  if (!input.grounded) return replace('answer_not_grounded', 'The provider said the manual does not cover the question; its text was not shown.');
  if (citations.length === 0) return replace('answer_without_citation', 'The answer has no valid citation and was replaced.');

  const evidenceStepIds = [...new Set(citations.map((c) => c.stepId))].slice(0, MAX_EVIDENCE_STEPS);
  const evidence = evidenceStepIds.flatMap((id) => {
    const step = getOwn(input.guide.steps, id);
    return step ? stepEvidenceParts(input.guide, step) : [];
  });
  const introduced = findIntroducedQuantities(evidence, cleaned);
  if (introduced.length > 0) return replace('answer_unverified_quantity', `Answer contained quantities not found in the cited steps (${introduced.join(', ')}) and was replaced.`);
  const links = findIntroducedLinks(evidence, cleaned);
  if (links.length > 0) return replace('answer_unverified_link', `Answer contained web or email addresses not found in the cited steps (${links.join(', ')}) and was replaced.`);
  return { text: cleaned, citations, notInManual: false, issues };
}
