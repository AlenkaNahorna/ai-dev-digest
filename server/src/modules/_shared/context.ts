import type { FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import { ForbiddenError } from '../../platform/errors.js';
import * as t from '../../db/schema.js';

export interface RequestContext {
  workspaceId: string;
  userId: string;
}

/**
 * Resolve the tenancy context for a request via the AuthProvider. In MVP
 * (LocalNoAuthProvider) this always returns the default workspace + system user.
 * Every module uses this so workspace scoping is never forgotten.
 */
export async function getContext(
  container: Container,
  req: FastifyRequest,
): Promise<RequestContext> {
  const [user, workspace] = await Promise.all([
    container.auth.currentUser(req),
    container.auth.currentWorkspace(req),
  ]);
  const [membership] = await container.db
    .select({ userId: t.workspaceMembers.userId })
    .from(t.workspaceMembers)
    .where(and(eq(t.workspaceMembers.workspaceId, workspace.id), eq(t.workspaceMembers.userId, user.id)));
  if (!membership) throw new ForbiddenError('User is not a member of this workspace');
  return { workspaceId: workspace.id, userId: user.id };
}
