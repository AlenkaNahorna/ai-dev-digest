import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextAttachmentsInput, ContextDocPath } from '@devdigest/shared';
import { getContext } from '../../../../_shared/context.js';
import { IdParams } from '../../../../_shared/schemas.js';
import { responseSchemas } from '../../../../_shared/response-schemas.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../../platform/errors.js';
import { ProjectContextError } from '../../../application/errors.js';

/** Map the application layer's errors onto the API error taxonomy. */
async function mapErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ProjectContextError)) throw err;
    if (err.kind === 'forbidden') throw new ForbiddenError(err.message);
    if (err.kind === 'not_found') throw new NotFoundError(err.message);
    throw new ValidationError(err.message, err.details);
  }
}

const DocQuery = z.object({ path: ContextDocPath });
const AttachmentsQuery = z.object({ repo_id: z.string().uuid() });

// Listing reads every discovered document to count tokens: cap it tighter than the global limit.
const LIST_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: '1 minute' } };

/**
 * Project Context routes (documents are VIEW-ONLY; no write endpoint exists for them).
 *
 *   GET /repos/:id/context              → discovered .md docs with tokens + footer facts
 *   GET /repos/:id/context/doc?path=    → one document's text
 *   GET|PUT /agents/:id/context         → attachments of an agent (per repo, ordered)
 *   GET|PUT /skills/:id/context         → attachments of a skill (per repo, ordered)
 *
 * Re-scan after a resync is just a re-fetch of the list (`POST /repos/:id/resync`
 * refreshes the clone). Attaching never versions the agent or skill.
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get(
    '/repos/:id/context',
    { schema: { params: IdParams, response: { 200: responseSchemas.projectContext } }, config: LIST_RATE_LIMIT },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return mapErrors(() => container.projectContext.list(workspaceId, req.params.id));
    },
  );

  app.get(
    '/repos/:id/context/doc',
    { schema: { params: IdParams, querystring: DocQuery, response: { 200: responseSchemas.contextDoc } }, config: LIST_RATE_LIMIT },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return mapErrors(() => container.projectContext.getDoc(workspaceId, req.params.id, req.query.path));
    },
  );

  for (const [kind, base] of [['agent', '/agents'], ['skill', '/skills']] as const) {
    app.get(
      `${base}/:id/context`,
      { schema: { params: IdParams, querystring: AttachmentsQuery, response: { 200: responseSchemas.contextAttachments } } },
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        return mapErrors(() =>
          container.projectContext.getAttachments(kind, workspaceId, req.params.id, req.query.repo_id),
        );
      },
    );

    app.put(
      `${base}/:id/context`,
      { schema: { params: IdParams, body: ContextAttachmentsInput, response: { 200: responseSchemas.contextAttachments } } },
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        return mapErrors(() => container.projectContext.putAttachments(kind, workspaceId, req.params.id, req.body));
      },
    );
  }
}
