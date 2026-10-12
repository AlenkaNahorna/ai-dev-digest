import type { PrBrief } from '@devdigest/shared';
import { boundFacts } from '../../domain/bound-facts.js';
import { normalizeBrief } from '../../domain/normalize-brief.js';
import { BriefError } from '../errors.js';
import type { BriefFactsPort, BriefLogPort, BriefModelPort, BriefStorePort } from '../ports/brief-ports.js';

export interface GenerateBriefDeps {
  facts: BriefFactsPort;
  model: BriefModelPort;
  store: BriefStorePort;
  log?: BriefLogPort;
}

/**
 * Generate (or regenerate) the brief of a PR: gather → refuse without files →
 * bound → exactly ONE model call → normalize → atomic replace. The stored brief
 * is touched only after everything succeeded (AC-5, AC-23).
 * Returns `undefined` when the PR is not in the workspace (AC-30).
 */
export function createGenerateBrief({ facts, model, store, log }: GenerateBriefDeps) {
  return async (workspaceId: string, pullId: string): Promise<PrBrief | undefined> => {
    const gathered = await facts.gather(workspaceId, pullId);
    if (!gathered) return undefined;

    // AC-28a: no changed file → no model call.
    if (gathered.files.length === 0) {
      log?.warn('pr-brief: no file data', { pullId, outcome: 'files_unavailable' });
      throw new BriefError('files_unavailable', 'File data is unavailable for this pull request');
    }

    const bounded = boundFacts(gathered);
    let output;
    try {
      output = await model.generate(workspaceId, pullId, bounded);
    } catch (err) {
      log?.warn('pr-brief: generation failed', { pullId, missing: bounded.missing, outcome: 'model_failed' });
      throw err instanceof BriefError ? err : new BriefError('model_failed', 'The brief could not be generated');
    }

    // Only the files actually shown to the model are valid references: a path
    // the 50-file cap omitted could not have been grounded in what it saw.
    const brief = normalizeBrief(
      output,
      bounded,
      bounded.files.map((f) => f.path),
    );
    await store.replace(workspaceId, pullId, brief);
    log?.info('pr-brief: generated', {
      pullId,
      missing: bounded.missing,
      partial: bounded.partial,
      risks: brief.risks.risks.length,
      focus: brief.review_focus.length,
      outcome: 'ok',
    });
    return brief;
  };
}
