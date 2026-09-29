import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionPatch } from '@devdigest/shared';
import { getContext } from '../../../../_shared/context.js';
import { IdParams } from '../../../../_shared/schemas.js';
import { ConventionsService } from '../../../service.js';

/**
 * conventions HTTP module (L02 — Conventions Extractor).
 *
 *   POST  /repos/:id/conventions/extract      → run the pipeline, persist a new scan
 *   GET   /repos/:id/conventions              → latest scan's candidates
 *   PATCH /conventions/:id                    → { accepted?, rule?, category? } (Accept/Reject + Edit)
 *   POST  /repos/:id/conventions/build-skill  → merge accepted candidates into a skill draft
 */
const BuildSkillBody = z.object({ candidate_ids: z.array(z.string().uuid()).min(1) });

export default async function conventionsRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.post(
    '/repos/:id/conventions/extract',
    {
      schema: { params: IdParams },
      // One completeStructured call over ~12 files per hit — cheap relative to
      // a review, but still an LLM call worth its own cap (mirrors the review
      // endpoint's tighter-than-default rate limit).
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: ConventionPatch } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.update(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/repos/:id/conventions/build-skill',
    { schema: { params: IdParams, body: BuildSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.buildSkillDraft(workspaceId, req.params.id, req.body.candidate_ids);
    },
  );
}
