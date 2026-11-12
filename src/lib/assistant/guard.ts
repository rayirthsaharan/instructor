import { NOT_IN_MANUAL_TEXT, type Citation } from '../ai/provider';
import { getOwn } from '../guide/selectors';
import { findIntroducedQuantities, validateCitations, type GuideIssue, type ValidatedGuide } from '../guide/validate';
import type { Step } from '../guide/schema';

export const MAX_ANSWER_CHARS = 4000;
export const MAX_CITATIONS = 6;

export interface FinalAnswer {
  text: string;
  citations: Citation[];
  notInManual: boolean;
  /** `no_citation`: grounded-looking answer with no valid citation; the UI says it could not point to the manual. */
  note: 'no_citation' | null;
  /** Server-side only: why anything was dropped or replaced. */
  issues: GuideIssue[];
}

/** Plain text only: control characters are removed (line breaks and tabs kept) and the length is bounded. */
export function cleanAnswerText(raw: string): string {
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_ANSWER_CHARS);
}

/** Everything a step shows the user, i.e. every place a quantity in an answer may legitimately come from. */
export function stepEvidenceText(step: Step): string {
  const parts: string[] = [step.title, step.instruction, step.sourceQuote ?? ''];
  for (const w of step.warnings) parts.push(w.text, w.sourceQuote ?? '');
  for (const f of ['why', 'commonMistake', 'checkpoint'] as const) {
    const g = step[f];
    if (g) parts.push(g.text, g.sourceQuote ?? '');
  }
  for (const p of step.partsUsed) if (p.quantity !== undefined) parts.push(String(p.quantity));
  return parts.join('\n');
}

/**
 * The last line of defence for an assistant answer: citations are validated against the guide, quantities must exist
 * in the cited steps, and what cannot be verified is replaced by the explicit not-in-manual answer.
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

  const notInManual = (): FinalAnswer => ({ text: NOT_IN_MANUAL_TEXT, citations: [], notInManual: true, note: null, issues });

  if (!cleaned) {
    issues.push({ code: 'answer_empty', path: '', severity: 'warning', message: 'The provider returned an empty answer.' });
    return notInManual();
  }
  const evidence = citations.map((c) => getOwn(input.guide.steps, c.stepId)).filter((s): s is Step => s !== undefined).map(stepEvidenceText).join('\n');
  const introduced = findIntroducedQuantities(evidence, cleaned);
  if (introduced.length > 0) {
    issues.push({ code: 'answer_unverified_quantity', path: '', severity: 'warning', message: `Answer contained quantities not found in the cited steps (${introduced.join(', ')}) and was replaced.` });
    return notInManual();
  }
  if (!input.grounded) return { text: cleaned, citations: [], notInManual: true, note: null, issues };
  if (citations.length === 0) {
    issues.push({ code: 'answer_without_citation', path: '', severity: 'warning', message: 'The answer has no valid citation.' });
    return { text: cleaned, citations: [], notInManual: false, note: 'no_citation', issues };
  }
  return { text: cleaned, citations, notInManual: false, note: null, issues };
}
