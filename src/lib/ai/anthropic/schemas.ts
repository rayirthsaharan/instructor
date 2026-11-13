import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { guideSchema } from '../../guide/schema';

/**
 * Model-facing shapes. The Guide schema itself is the single source of truth (D-007): these are derived from it.
 * The only change is `steps` as an array, because the API's JSON schema subset has no free-form maps; code turns the
 * array into the stored map when merging. Numeric and length limits are carried by the SDK as descriptions and are
 * enforced afterwards by `validateGuide`, never trusted from the model.
 */
export const modelGuideSchema = guideSchema.extend({ steps: z.array(guideSchema.shape.steps.valueType) });
export type ModelGuide = z.infer<typeof modelGuideSchema>;

export const analysisOutputSchema = z.object({
  isProductManual: z.boolean().describe('True only if the pages are a product manual, assembly guide or instruction sheet.'),
  notManualReason: z.string().max(500).optional().describe('When isProductManual is false: one short sentence saying what the pages are instead.'),
  guide: modelGuideSchema.optional().describe('Required when isProductManual is true.'),
});
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

export const partMappingSchema = z.object({
  mappings: z
    .array(
      z.object({
        keepId: z.string().describe('The part id to keep.'),
        duplicateIds: z.array(z.string()).describe('Ids of parts that are the same physical part as keepId.'),
      }),
    )
    .describe('Only groups of parts that are clearly the same physical part. Leave out anything uncertain.'),
});
export type PartMappingOutput = z.infer<typeof partMappingSchema>;

export const verifyOutputSchema = z.object({
  reviews: z.array(
    z.object({
      stepId: z.string(),
      verdict: z.enum(['supported', 'corrected', 'unsupported']),
      confidence: z.enum(['high', 'medium', 'low']).describe('Confidence after checking the step against the page images.'),
      correctedInstruction: z.string().max(4000).optional().describe('Only with verdict "corrected": the instruction rewritten to match the pages exactly.'),
      unsupportedInferred: z
        .array(z.enum(['why', 'commonMistake', 'checkpoint']))
        .optional()
        .describe('Inferred guidance fields that the manual does not support and must be removed.'),
      reason: z.string().max(500).describe('One short sentence naming what you compared and what you found.'),
    }),
  ),
});
export type VerifyOutput = z.infer<typeof verifyOutputSchema>;

export const answerOutputSchema = z.object({
  // `answer` is first so it can be streamed while the rest of the JSON is still being written.
  answer: z.string().describe('Plain-text answer for the user, or a short statement that the manual does not contain it.'),
  grounded: z.boolean().describe('False when the manual does not contain the answer; then citations must be empty.'),
  citations: z.array(z.object({ stepId: z.string(), pageIndex: z.number().int() })).describe('Steps the answer relies on.'),
});
export type AnswerOutput = z.infer<typeof answerOutputSchema>;

/** The SDK helper turns a Zod schema into `output_config.format` (JSON schema). */
export const outputFormat = {
  analysis: () => zodOutputFormat(analysisOutputSchema),
  partMapping: () => zodOutputFormat(partMappingSchema),
  verify: () => zodOutputFormat(verifyOutputSchema),
  answer: () => zodOutputFormat(answerOutputSchema),
};
