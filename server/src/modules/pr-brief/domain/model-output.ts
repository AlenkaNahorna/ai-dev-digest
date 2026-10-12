import { z } from 'zod';
import { RiskSeverity } from '@devdigest/shared';

/**
 * What the model returns (AC-19): exactly the summary, the risks and the review
 * focus. Bounds here are generous on purpose so `completeStructured` does not
 * re-ask; the precise caps of AC-34 are applied by `normalizeBrief`.
 */
export const BRIEF_SCHEMA_NAME = 'pr_brief';

export const ModelBriefOutput = z.object({
  // Non-empty so an empty summary makes completeStructured re-ask instead of storing a blank brief.
  summary: z.string().trim().min(1).max(5_000),
  risks: z
    .array(
      z.object({
        kind: z.string().max(500),
        title: z.string().max(1_000),
        explanation: z.string().max(5_000),
        severity: RiskSeverity,
        file_refs: z.array(z.string().max(1_000)).max(50),
      }),
    )
    .max(50),
  review_focus: z
    .array(
      z.object({
        file: z.string().max(1_000),
        line: z.number().int().positive().nullish(),
        reason: z.string().max(2_000),
      }),
    )
    .max(50),
});
export type ModelBriefOutput = z.infer<typeof ModelBriefOutput>;
