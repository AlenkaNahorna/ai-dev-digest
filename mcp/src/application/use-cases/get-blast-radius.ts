import { shapeBlast } from '../../domain/blast-shape.js';
import type { BlastView } from '../../domain/blast-shape.js';
import type { DevDigestApi } from '../ports/devdigest-api.js';
import type { Resolver } from './resolve.js';

export interface GetBlastRadiusInput {
  readonly repo: string;
  readonly pr: number;
}

/**
 * `get_blast_radius`: pure read of `GET /pulls/:id/blast`. Degraded data is
 * returned as data (with a hint), never thrown; unknown repo/PR hints come from the resolver.
 */
export function createGetBlastRadius(
  api: Pick<DevDigestApi, 'getBlastRadius'>,
  resolver: Pick<Resolver, 'resolvePull'>,
): (input: GetBlastRadiusInput) => Promise<BlastView> {
  return async (input) => {
    const { pull } = await resolver.resolvePull(input.repo, input.pr);
    return shapeBlast(await api.getBlastRadius(pull.id));
  };
}
