import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrDetail, PrMeta, PrReviewComment } from '@devdigest/shared';
import { PrCommentInput } from '@devdigest/shared';
import { getContext } from '../../../../_shared/context.js';
import { IdParams } from '../../../../_shared/schemas.js';
import { AppError, NotFoundError } from '../../../../../platform/errors.js';
import { PullsService, PullsProviderError } from '../../../application/use-cases/pulls.js';
import { PullsRepository } from '../../outbound/persistence/repository.js';
import { responseSchemas } from '../../../../_shared/response-schemas.js';

export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new PullsService(new PullsRepository(container.db), { resolve: () => container.github() });
  const logger = { warn(meta: unknown, message: string) { app.log.warn(meta, message); } };

  app.get('/repos/:id/pulls', { schema: { params: IdParams, response: { 200: responseSchemas.pulls } } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(container, req);
    const result = await service.list(workspaceId, req.params.id, logger);
    if (!result) throw new NotFoundError('Repo not found');
    return result;
  });
  app.get('/pulls/:id', { schema: { params: IdParams, response: { 200: responseSchemas.pull } } }, async (req): Promise<PrDetail> => {
    const { workspaceId } = await getContext(container, req);
    const result = await service.detail(workspaceId, req.params.id, logger);
    if (!result) throw new NotFoundError('Pull request not found');
    return result;
  });
  app.get('/pulls/:id/comments', { schema: { params: IdParams, response: { 200: responseSchemas.comments } } }, async (req): Promise<PrReviewComment[]> => {
    const { workspaceId } = await getContext(container, req);
    const result = await service.listComments(workspaceId, req.params.id, logger);
    if (!result) throw new NotFoundError('Pull request not found');
    return result;
  });
  app.post('/pulls/:id/comments', { schema: { params: IdParams, body: PrCommentInput } }, async (req): Promise<PrReviewComment> => {
    const { workspaceId } = await getContext(container, req);
    try {
      const result = await service.createComment(workspaceId, req.params.id, {
        path: req.body.path, line: req.body.line, ...(req.body.side ? { side: req.body.side } : {}),
        body: req.body.body, ...(req.body.in_reply_to != null ? { inReplyTo: req.body.in_reply_to } : {}), commitId: '',
      });
      if (!result) throw new NotFoundError('Pull request not found');
      return result;
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (err instanceof PullsProviderError && err.reason === 'unavailable') throw new AppError('github_unavailable', err.message, 400);
      if (err instanceof PullsProviderError) throw new AppError('github_comment_failed', err.message, 400, { cause: String(err.causeValue) });
      throw err;
    }
  });
}
