import { z } from 'zod';

/** Current Guide schema version. Bump it and add a step to `migrateGuide` on any breaking change. */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/** Normalised 0..1 rectangle, relative to the exact page image sent to the model. */
export const regionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().gt(0).max(1),
    h: z.number().gt(0).max(1),
  })
  .refine((r) => r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9, 'region extends beyond the page');

export const sourceRefSchema = z.object({
  pageIndex: z.number().int().min(0),
  /** Diagram panel detected in code; preferred over raw coordinates (ARCHITECTURE section 10, item 3). */
  panelId: z.string().min(1).optional(),
  region: regionSchema.optional(),
  /** True when the exact area is unknown and the UI must show the page/panel with an "approximate area" note. */
  regionFallback: z.boolean().default(false),
});

/** Guidance that is either the manual's own words (with a quote) or labelled as inferred by Instructor. */
export const guidanceSchema = z.object({
  text: z.string().min(1),
  origin: z.enum(['manual', 'inferred']),
  sourceQuote: z.string().min(1).optional(),
});

export const warningSchema = z.object({
  text: z.string().min(1),
  severity: z.enum(['caution', 'warning']),
  /** Verbatim text from the manual. Required when the manual states the warning in words. */
  sourceQuote: z.string().min(1).optional(),
  interpretedFromDiagram: z.boolean().default(false),
});

export const partSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  manualLabel: z.string().min(1).optional(),
  quantity: z.number().int().positive().optional(),
  description: z.string().optional(),
  source: sourceRefSchema,
});

export const toolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  included: z.boolean(),
  source: sourceRefSchema.optional(),
});

export const highlightSchema = z.object({
  source: sourceRefSchema,
  label: z.string().optional(),
  partId: z.string().min(1).optional(),
});

export const stepSchema = z.object({
  id: z.string().min(1),
  phaseId: z.string().min(1),
  title: z.string().min(1),
  instruction: z.string().min(1),
  partsUsed: z.array(z.object({ partId: z.string().min(1), quantity: z.number().int().positive().optional() })).default([]),
  toolsUsed: z.array(z.string().min(1)).default([]),
  why: guidanceSchema.optional(),
  commonMistake: guidanceSchema.optional(),
  checkpoint: guidanceSchema.optional(),
  warnings: z.array(warningSchema).default([]),
  sourceQuote: z.string().min(1).optional(),
  irreversible: z.boolean().default(false),
  confidence: z.enum(['high', 'medium', 'low']),
  interpretedFromDiagram: z.boolean().default(false),
  sources: z.array(sourceRefSchema).min(1),
  highlights: z.array(highlightSchema).default([]),
});

export const phaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  stepIds: z.array(z.string().min(1)),
});

export const glossaryEntrySchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  source: sourceRefSchema.optional(),
});

export const unreadablePageSchema = z.object({
  pageIndex: z.number().int().min(0),
  reason: z.string().optional(),
});

export const guideSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  language: z.string().min(2),
  title: z.string().min(1),
  summary: z.string(),
  category: z.string().min(1),
  estimatedMinutes: z.number().int().positive().optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  peopleNeeded: z.number().int().min(1).default(1),
  safetyCritical: z.boolean().default(false),
  tools: z.array(toolSchema).default([]),
  parts: z.array(partSchema).default([]),
  phases: z.array(phaseSchema).min(1),
  /** Unordered map by id. Order lives only in `phases[].stepIds`. */
  steps: z.record(z.string(), stepSchema),
  glossary: z.array(glossaryEntrySchema).default([]),
  unreadablePages: z.array(unreadablePageSchema).default([]),
});

export type Region = z.infer<typeof regionSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type Guidance = z.infer<typeof guidanceSchema>;
export type Warning = z.infer<typeof warningSchema>;
export type Part = z.infer<typeof partSchema>;
export type Tool = z.infer<typeof toolSchema>;
export type Highlight = z.infer<typeof highlightSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;
export type UnreadablePage = z.infer<typeof unreadablePageSchema>;
export type Guide = z.infer<typeof guideSchema>;
export type Confidence = Step['confidence'];

export type MigrateResult = { ok: true; raw: unknown } | { ok: false; error: string };

/**
 * Entry point for reading stored or model-produced guides of any known version.
 * Returns data in the current shape (not yet validated). Only version 1 exists today;
 * future versions add `if (version === 1) { raw = upgrade1to2(raw); version = 2 }` steps.
 */
export function migrateGuide(raw: unknown): MigrateResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Guide must be an object.' };
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (version === CURRENT_SCHEMA_VERSION) return { ok: true, raw };
  if (typeof version !== 'number') return { ok: false, error: 'Guide is missing a numeric schemaVersion.' };
  if (version > CURRENT_SCHEMA_VERSION) return { ok: false, error: `Guide schemaVersion ${version} is newer than supported (${CURRENT_SCHEMA_VERSION}).` };
  return { ok: false, error: `Unknown guide schemaVersion ${version}.` };
}
