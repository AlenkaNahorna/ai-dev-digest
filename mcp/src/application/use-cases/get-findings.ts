import { shapeReviews } from '../../domain/review-shape.js';
import type { ShapedReview, SeverityLevel } from '../../domain/review-shape.js';
import { clipText } from '../../domain/text.js';
import { HintError } from '../errors.js';
import type { DevDigestApi } from '../ports/devdigest-api.js';
import type { Resolver } from './resolve.js';

export interface GetFindingsInput {
  readonly repo: string;
  readonly pr: number;
  readonly agent?: string | undefined;
  readonly severity?: SeverityLevel | undefined;
}

export interface GetFindingsOutput {
  reviews: ShapedReview[];
}

/** `get_findings`: pure reads — never starts a run (server/INSIGHTS 2026-09-21). */
export function createGetFindings(
  api: Pick<DevDigestApi, 'listReviews'>,
  resolver: Pick<Resolver, 'resolvePull' | 'resolveAgent'>,
): (input: GetFindingsInput) => Promise<GetFindingsOutput> {
  return async (input) => {
    const { pull, repo } = await resolver.resolvePull(input.repo, input.pr);
    const agent = input.agent === undefined ? undefined : await resolver.resolveAgent(input.agent);
    const all = await api.listReviews(pull.id);
    const rows = agent === undefined ? all : all.filter((r) => r.agent_id === agent.id);
    const reviews = shapeReviews(rows, { minSeverity: input.severity });
    if (reviews.length === 0) {
      const who =
        agent === undefined ? '' : ` by agent '${clipText(agent.name, 60)}'`;
      throw new HintError(
        `No reviews${who} on PR #${input.pr} of ${repo.full_name} yet. Call run_agent_on_pr to run one.`,
      );
    }
    return { reviews };
  };
}
