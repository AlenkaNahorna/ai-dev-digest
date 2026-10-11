import { z } from 'zod';

/**
 * The shape the MODEL is asked to produce (structured output).
 *
 * Deliberately lenient and free of length/pattern constraints: provider
 * structured-output modes reject many JSON-Schema keywords, and a model that
 * misses a limit must degrade ONE section, not fail the whole request. The
 * strict, bounded contract (`OnboardingTourContent`) is enforced afterwards in
 * `build-content.ts`, section by section, together with evidence grounding.
 *
 * Every field is required (null/[] mean "none") so strict JSON-schema mode
 * accepts it.
 */
const Reason = z.string().nullable();

export const ModelTourOutput = z.object({
  architecture: z.object({
    unavailable_reason: Reason,
    summary: z.string(),
    diagram_nodes: z.array(
      z.object({ id: z.string(), label: z.string(), kind: z.string(), path: z.string().nullable() }),
    ),
    diagram_edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().nullable() })),
  }),
  critical_paths: z.object({
    unavailable_reason: Reason,
    entries: z.array(z.object({ path: z.string(), role: z.string() })),
  }),
  local_run: z.object({
    unavailable_reason: Reason,
    steps: z.array(
      z.object({
        order: z.number(),
        instruction: z.string(),
        command: z.string().nullable(),
        source: z.string(),
      }),
    ),
  }),
  reading_path: z.object({
    unavailable_reason: Reason,
    entries: z.array(z.object({ order: z.number(), path: z.string(), reason: z.string() })),
  }),
  first_tasks: z.object({
    unavailable_reason: Reason,
    tasks: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
        files: z.array(z.string()),
        outcome: z.string(),
      }),
    ),
  }),
});
export type ModelTourOutput = z.infer<typeof ModelTourOutput>;

export const MODEL_OUTPUT_SCHEMA_NAME = 'OnboardingTour';
