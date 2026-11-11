import { z } from 'zod';

/** Current Guide schema version. Bump it and add a step to `migrateGuide` on any breaking change. */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/** Normalised 0..1 rectangle, relative to the exact page image sent to the model. */
const id = () => z.string().min(1).max(100);
const short = () => z.string().min(1).max(300);
const long = () => z.string().min(1).max(4000);
const quote = () => z.string().max(2000);

export const regionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().gt(0).max(1),
    h: z.number().gt(0).max(1),
  })
  .refine((r) => r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9, 'region extends beyond the page');

export const sourceRefSchema = z.object({
  pageIndex: z.number().int().min(0).max(100000),
  /** Diagram panel detected in code; preferred over raw coordinates (ARCHITECTURE section 10, item 3). */
  panelId: id().optional(),
  region: regionSchema.optional(),
  /** True when the exact area is unknown and the UI must show the page/panel with an "approximate area" note. */
  regionFallback: z.boolean().default(false),
});

/** Guidance that is either the manual's own words (with a quote) or labelled as inferred by Instructor. */
export const guidanceSchema = z.object({
  text: long(),
  origin: z.enum(['manual', 'inferred']),
  sourceQuote: quote().optional(),
});

export const warningSchema = z.object({
  text: long(),
  severity: z.enum(['caution', 'warning']),
  /** Verbatim text from the manual. Required when the manual states the warning in words. */
  sourceQuote: quote().optional(),
  interpretedFromDiagram: z.boolean().default(false),
});

export const partSchema = z.object({
  id: id(),
  name: short(),
  manualLabel: short().optional(),
  quantity: z.number().int().positive().max(100000).optional(),
  description: z.string().max(2000).optional(),
  source: sourceRefSchema,
});

export const toolSchema = z.object({
  id: id(),
  name: short(),
  included: z.boolean(),
  source: sourceRefSchema.optional(),
});

export const highlightSchema = z.object({
  source: sourceRefSchema,
  label: z.string().max(300).optional(),
  partId: id().optional(),
});

export const stepSchema = z.object({
  id: id(),
  phaseId: id(),
  title: short(),
  instruction: long(),
  partsUsed: z.array(z.object({ partId: id(), quantity: z.number().int().positive().max(100000).optional() })).max(100).default([]),
  toolsUsed: z.array(id()).max(100).default([]),
  why: guidanceSchema.optional(),
  commonMistake: guidanceSchema.optional(),
  checkpoint: guidanceSchema.optional(),
  warnings: z.array(warningSchema).max(20).default([]),
  sourceQuote: quote().optional(),
  irreversible: z.boolean().default(false),
  confidence: z.enum(['high', 'medium', 'low']),
  interpretedFromDiagram: z.boolean().default(false),
  sources: z.array(sourceRefSchema).min(1).max(20),
  highlights: z.array(highlightSchema).max(50).default([]),
});

export const phaseSchema = z.object({
  id: id(),
  title: short(),
  stepIds: z.array(id()).min(1).max(1000),
});

export const glossaryEntrySchema = z.object({
  term: short(),
  definition: long(),
  source: sourceRefSchema.optional(),
});

export const unreadablePageSchema = z.object({
  pageIndex: z.number().int().min(0),
  reason: z.string().max(1000).optional(),
});

export const guideSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  language: z.string().min(2).max(35),
  title: short(),
  summary: z.string().max(4000),
  category: short(),
  estimatedMinutes: z.number().int().positive().max(100000).optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  peopleNeeded: z.number().int().min(1).max(100).default(1),
  safetyCritical: z.boolean().default(false),
  tools: z.array(toolSchema).max(200).default([]),
  parts: z.array(partSchema).max(500).default([]),
  phases: z.array(phaseSchema).min(1).max(100),
  /** Unordered map by id. Order lives only in `phases[].stepIds`. */
  steps: z
    .record(z.string(), stepSchema)
    .refine((m) => Object.keys(m).length >= 1, 'a guide needs at least one step')
    .refine((m) => Object.keys(m).length <= 1000, 'too many steps'),
  glossary: z.array(glossaryEntrySchema).max(500).default([]),
  unreadablePages: z.array(unreadablePageSchema).max(1000).default([]),
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
