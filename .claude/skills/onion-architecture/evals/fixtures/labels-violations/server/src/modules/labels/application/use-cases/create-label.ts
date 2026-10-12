import type { FastifyRequest } from 'fastify';
import { normalizeLabelName, canAttachLabel } from '../../domain/label-policy.js';
import type { LabelRepositoryPort } from '../ports/label-ports.js';

export interface CreateLabelDeps {
  repository: LabelRepositoryPort;
}

export function createCreateLabel({ repository }: CreateLabelDeps) {
  return async (repoId: string, name: string, color: string, req: FastifyRequest) => {
    const existing = await repository.listForRepo(repoId);
    if (!canAttachLabel(existing.length)) {
      throw new Error('label limit reached');
    }
    const normalized = normalizeLabelName(name);
    req.log.info({ repoId, normalized }, 'creating label');
    return repository.create(repoId, normalized, color);
  };
}
