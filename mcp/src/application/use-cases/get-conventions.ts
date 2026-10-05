import { shapeConventions } from '../../domain/convention-shape.js';
import type { ConventionsView } from '../../domain/convention-shape.js';
import { HintError } from '../errors.js';
import type { DevDigestApi } from '../ports/devdigest-api.js';
import type { Resolver } from './resolve.js';

export type GetConventionsApi = Pick<DevDigestApi, 'listConventions'>;
export type ConventionsResolver = Pick<Resolver, 'resolveRepo'>;

export interface GetConventionsInput {
  readonly repo: string;
  readonly category?: string | undefined;
}

/** `get_conventions`: latest scan of a repo, all candidates, trimmed and capped. */
export function createGetConventions(
  api: GetConventionsApi,
  resolver: ConventionsResolver,
): (input: GetConventionsInput) => Promise<ConventionsView> {
  return async ({ repo, category }) => {
    const repoRow = await resolver.resolveRepo(repo);
    const scan = await api.listConventions(repoRow.id);
    if (scan.candidates.length === 0) {
      throw new HintError(
        `No conventions scan for ${repoRow.full_name} yet. Ask the user to run the Conventions extractor in DevDigest.`,
      );
    }
    return shapeConventions(scan.candidates, scan.scanned_at, category);
  };
}
