import type { Container } from '../../../../platform/container.js';
import { isReservedTag } from '../../domain/tag-policy.js';

export function createAssignTag(container: Container) {
  return async (pullId: string, name: string) => {
    if (isReservedTag(name)) {
      throw new Error('cannot assign a reserved tag');
    }
    const repository = container.tags.repository;
    return repository.assign(pullId, name);
  };
}
