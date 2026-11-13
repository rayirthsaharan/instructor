import { z } from 'zod';
import { regionSchema } from '../../src/lib/guide/schema';

/**
 * Hand-built answer key for one test manual (docs/ACCURACY_TEST_PLAN.md section 4).
 * Page indices are zero-based and regions are normalised 0..1 against the page image rendered at the pipeline's
 * resolution (PAGE_IMAGE_MAX_DIM), the same image the model sees. Built by QA, reviewed by the senior engineer.
 */

/** One way of recognising a thing in model output: any alternative matches (case-insensitive substring). */
const anchorGroup = z.array(z.string().min(1)).min(1);

export const keyPartSchema = z.object({
  key: z.string().min(1),
  /** The label printed in the manual ("A", "12"), when there is one. */
  label: z.string().min(1).optional(),
  /** Accepted names, in the manual's language and in English. */
  names: z.array(z.string().min(1)).min(1),
  quantity: z.number().int().positive().optional(),
  pageIndex: z.number().int().min(0),
});

export const keyStepSchema = z.object({
  /** The manual's own step number, or the order of the step when the manual does not number them. */
  n: z.number().int().positive(),
  pageIndex: z.number().int().min(0),
  /** The diagram a person would pick for this step. */
  region: regionSchema,
  /** Other diagrams that are equally right (e.g. a detail inset). */
  altRegions: z.array(z.object({ pageIndex: z.number().int().min(0), region: regionSchema })).default([]),
  /**
   * Used only to map a model step onto this key step: every group must match the model step's title + instruction.
   * Keep them short and distinctive ("dowel", "cam bolt"); add the English word for non-English manuals.
   */
  anchors: z.array(anchorGroup).min(1),
  partsUsed: z.array(z.object({ part: z.string().min(1), quantity: z.number().int().positive().optional() })).default([]),
  summary: z.string().min(1),
});

export const keyWarningSchema = z.object({
  /** Verbatim, exactly as printed (only line breaks collapsed). */
  text: z.string().min(1),
  pageIndex: z.number().int().min(0),
  /** Key step it belongs to, when the manual places it in a step. */
  step: z.number().int().positive().optional(),
});

export const answerKeySchema = z.object({
  manualId: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  language: z.string().min(2),
  pageCount: z.number().int().positive(),
  source: z.object({
    url: z.string().min(1),
    licence: z.string().min(1),
    attribution: z.string().min(1),
  }),
  builtBy: z.string().min(1),
  reviewedBy: z.string().optional(),
  parts: z.array(keyPartSchema),
  steps: z.array(keyStepSchema).min(1),
  warnings: z.array(keyWarningSchema),
  notes: z.string().optional(),
});

export type AnswerKey = z.infer<typeof answerKeySchema>;
export type KeyPart = z.infer<typeof keyPartSchema>;
export type KeyStep = z.infer<typeof keyStepSchema>;

/** Parses a key and checks its internal references; throws with every problem listed. */
export function parseAnswerKey(raw: unknown): AnswerKey {
  const key = answerKeySchema.parse(raw);
  const problems: string[] = [];
  const partKeys = new Set(key.parts.map((p) => p.key));
  if (partKeys.size !== key.parts.length) problems.push('duplicate part key');
  const ns = key.steps.map((s) => s.n);
  if (new Set(ns).size !== ns.length) problems.push('duplicate step number');
  for (const s of key.steps) {
    if (s.pageIndex >= key.pageCount) problems.push(`step ${s.n}: page ${s.pageIndex} is outside the manual`);
    for (const u of s.partsUsed) if (!partKeys.has(u.part)) problems.push(`step ${s.n}: unknown part "${u.part}"`);
  }
  for (const w of key.warnings) {
    if (w.pageIndex >= key.pageCount) problems.push(`warning "${w.text.slice(0, 30)}": page outside the manual`);
    if (w.step !== undefined && !ns.includes(w.step)) problems.push(`warning "${w.text.slice(0, 30)}": unknown step ${w.step}`);
  }
  for (const p of key.parts) if (p.pageIndex >= key.pageCount) problems.push(`part ${p.key}: page outside the manual`);
  if (problems.length > 0) throw new Error(`Answer key ${key.manualId} is inconsistent: ${problems.join('; ')}`);
  return key;
}
