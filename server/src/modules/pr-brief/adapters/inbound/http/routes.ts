import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrBrief } from '@devdigest/shared';
import { getContext } from '../../../../_shared/context.js';
import { IdParams } from '../../../../_shared/schemas.js';
import { responseSchemas } from '../../../../_shared/response-schemas.js';
import { AppError, NotFoundError } from '../../../../../platform/errors.js';
import { BriefError } from '../../../application/errors.js';
import type { BriefLogPort } from '../../../application/ports/brief-ports.js';
import { createGenerateBrief } from '../../../application/use-cases/generate-brief.js';
import { createGetBrief } from '../../../application/use-cases/get-brief.js';
import { BriefRepository } from '../../outbound/persistence/brief.repository.js';
import { FactsGatherer } from '../../outbound/providers/facts-gatherer.js';
import { LlmBriefModel } from '../../outbound/providers/llm-brief-model.js';

function mapError(err: unknown): never {
  if (err instanceof BriefError) {
    if (err.kind === 'files_unavailable') throw new AppError('brief_files_unavailable', err.message, 422);
    throw new AppError('brief_model_failed', err.message, 502);
  }
  throw err;
}

function requestLog(req: FastifyRequest): BriefLogPort {
  return {
    info: (msg, fields) => req.log.info(fields, msg),
    warn: (msg, fields) => req.log.warn(fields, msg),
  };
}

/**
 * PR Brief routes.
 *
 *   GET  /pulls/:id/brief → the stored brief or null (one DB read; never calls an LLM)
 *   POST /pulls/:id/brief → generate or regenerate (exactly one model call)
 */
export default async function prBriefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const store = new BriefRepository(container.db);
  const getBrief = createGetBrief({ store });

  app.get('/pulls/:id/brief', { schema: { params: IdParams, response: { 200: responseSchemas.brief } } }, async (req): Promise<PrBrief | null> => {
    const { workspaceId } = await getContext(container, req);
    const brief = await getBrief(workspaceId, req.params.id);
    if (brief === undefined) throw new NotFoundError('Pull request not found');
    return brief;
  });

  // Each press costs one model call → tight per-route limit (as the intent re-derive route).
  app.post(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: responseSchemas.briefRecord } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<PrBrief> => {
      const { workspaceId } = await getContext(container, req);
      const log = requestLog(req);
      const generateBrief = createGenerateBrief({
        facts: new FactsGatherer(container, log),
        model: new LlmBriefModel(container, log),
        store,
        log,
      });
      try {
        const brief = await generateBrief(workspaceId, req.params.id);
        if (!brief) throw new NotFoundError('Pull request not found');
        return brief;
      } catch (err) {
        return mapError(err);
      }
    },
  );
}
