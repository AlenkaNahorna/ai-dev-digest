import { ONBOARDING_LIMITS, type TourProvenance } from '@devdigest/shared/contracts/onboarding-generator.js';
import type { OnboardingTourContent } from '@devdigest/shared/contracts/onboarding-generator.js';
import type { CapturedEvidence } from '../../domain/evidence.js';
import { buildTourContent, isUsableTour } from '../../domain/build-content.js';
import { GENERATION_TIMING } from '../../domain/limits.js';
import { GenerationFailure } from '../../domain/lifecycle.js';
import { buildPrompt } from '../../domain/prompt.js';
import type { Clock, TourModel } from '../ports/onboarding-ports.js';

/**
 * Step 3a — pure generation + validation. No database, no queue: given captured
 * evidence and a model port, produce a validated, grounded tour or throw a
 * `GenerationFailure` with a safe category.
 */
export interface GeneratedTour {
  content: OnboardingTourContent;
  provenance: TourProvenance;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

export interface GenerateTourDeps {
  model: TourModel;
  clock: Clock;
}

export function createGenerateTour(deps: GenerateTourDeps) {
  return async function generateTour(workspaceId: string, evidence: CapturedEvidence): Promise<GeneratedTour> {
    let prompt;
    try {
      prompt = buildPrompt(evidence);
    } catch {
      // Evidence cannot be fitted into the bounded prompt even after trimming.
      throw new GenerationFailure('evidence_unavailable', 'evidence exceeds prompt bounds');
    }

    const result = await deps.model.generate({
      workspaceId,
      repoFullName: evidence.repoFullName,
      system: prompt.system,
      user: prompt.user,
      deadlineMs: GENERATION_TIMING.providerDeadlineMs,
    });

    // A response over the serialized cap is rejected outright (never partially used).
    if (result.rawBytes > ONBOARDING_LIMITS.responseBytes) {
      throw new GenerationFailure('invalid_output', `response ${result.rawBytes} bytes exceeds cap`);
    }

    const built = buildTourContent(result.output, evidence);
    if (!isUsableTour(built.content)) {
      throw new GenerationFailure('invalid_output', 'no usable architecture or reading path');
    }

    const notes = [...evidence.report.notes];
    for (const t of prompt.trimmed) notes.push(`prompt trimmed: ${t}`);
    const provenance: TourProvenance = {
      source_sha: evidence.sourceSha,
      indexed_at: evidence.indexedAt.toISOString(),
      indexer_version: evidence.indexerVersion,
      index_status: evidence.indexStatus,
      generated_at: deps.clock.now().toISOString(),
      evidence: {
        ...evidence.report,
        truncated: evidence.report.truncated || prompt.trimmed.length > 0,
        notes: notes.slice(0, 12).map((n) => n.slice(0, 200)),
      },
      degraded_sections: built.degraded,
    };

    return {
      content: built.content,
      provenance,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    };
  };
}

export type GenerateTour = ReturnType<typeof createGenerateTour>;
