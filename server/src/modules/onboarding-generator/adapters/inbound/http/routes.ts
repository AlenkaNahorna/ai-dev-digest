import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  OnboardingTourState,
  PublicOnboardingSnapshot,
  RegenerateAccepted,
  ShareCreateInput,
  ShareCreated,
  ShareList,
  ShareRevoked,
  ShareToken,
} from '@devdigest/shared/contracts/onboarding-generator.js';
import { getContext } from '../../../../_shared/context.js';
import { IdParams } from '../../../../_shared/schemas.js';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../../../../../platform/errors.js';
import { OnboardingError } from '../../../application/errors.js';
import { createOnboardingGenerator, type OnboardingGenerator } from '../../../index.js';

/**
 * onboarding-generator HTTP adapter (thin: validate → use case → serialize).
 *
 *   GET    /repos/:id/onboarding-tour                  persisted state (never calls an LLM)
 *   POST   /repos/:id/onboarding-tour/regenerate       owner-only, 202 queued
 *   POST   /repos/:id/onboarding-tour/shares           owner-only, returns the raw link ONCE
 *   GET    /repos/:id/onboarding-tour/shares           owner-only metadata (no tokens)
 *   DELETE /repos/:id/onboarding-tour/shares/:shareId  owner-only, creator-only revoke
 *   GET    /public/onboarding/:token                   the only anonymous read
 */
const ShareIdParams = z.object({ id: z.string().uuid(), shareId: z.string().uuid() });
const TokenParams = z.object({ token: z.string().max(256) });

function mapErrors(err: unknown): never {
  if (err instanceof OnboardingError) {
    switch (err.kind) {
      case 'forbidden':
        throw new ForbiddenError(err.message);
      case 'not_found':
        throw new NotFoundError(err.message);
      case 'invalid':
        throw new ValidationError(err.message);
      case 'rate_limited':
        throw new AppError('rate_limited', err.message, 429);
      case 'conflict':
      case 'unavailable':
        throw new AppError(err.kind, err.message, 409);
    }
  }
  throw err;
}

/** Rate-limit bucket: user → workspace → IP (never an attacker-chosen header). */
async function bucketKey(app: FastifyInstance, req: FastifyRequest): Promise<string> {
  try {
    const user = await app.container.auth.currentUser(req);
    if (user?.id) return `u:${user.id}`;
    const ws = await app.container.auth.currentWorkspace(req);
    if (ws?.id) return `w:${ws.id}`;
  } catch {
    /* fall through to IP */
  }
  return `ip:${req.ip}`;
}

export default async function onboardingGeneratorRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();
  const log = {
    info: (o: Record<string, unknown>, m: string) => app.log.info(o, m),
    warn: (o: Record<string, unknown>, m: string) => app.log.warn(o, m),
  };
  const gen: OnboardingGenerator = createOnboardingGenerator(app.container, log);
  gen.start();

  // Boot reconciliation: never during GET, never mass-generating for repos without a request.
  app.addHook('onReady', async () => {
    try {
      const r = await gen.reconcile();
      if (r.requeued > 0 || r.resumed > 0) app.log.info(r, 'onboarding: reconciled generation requests');
    } catch (err) {
      app.log.warn({ err: (err as Error).message }, 'onboarding: reconciliation failed (non-fatal)');
    }
  });

  if (app.container.config.nodeEnv === 'production' && gen.settings.publicOrigin === null) {
    app.log.warn('PUBLIC_WEB_ORIGIN is not set: onboarding share links are local-only and will not work for others.');
  }

  app.get(
    '/repos/:id/onboarding-tour',
    { schema: { params: IdParams, response: { 200: OnboardingTourState } } },
    async (req) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      try {
        return await gen.getState(workspaceId, userId, req.params.id);
      } catch (err) {
        return mapErrors(err);
      }
    },
  );

  app.post(
    '/repos/:id/onboarding-tour/regenerate',
    {
      schema: { params: IdParams, response: { 202: RegenerateAccepted } },
      config: { rateLimit: { max: 3, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => bucketKey(app, req) } },
    },
    async (req, reply) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      try {
        const res = await gen.regenerate(workspaceId, userId, req.params.id);
        reply.status(202);
        return { request_id: res.requestId, status: res.status };
      } catch (err) {
        return mapErrors(err);
      }
    },
  );

  app.post(
    '/repos/:id/onboarding-tour/shares',
    {
      schema: { params: IdParams, body: ShareCreateInput, response: { 201: ShareCreated } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => bucketKey(app, req) } },
    },
    async (req, reply) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      try {
        const created = await gen.shares.create(workspaceId, userId, req.params.id, req.body.tour_id);
        reply.status(201).header('Cache-Control', 'no-store');
        return created;
      } catch (err) {
        return mapErrors(err);
      }
    },
  );

  app.get(
    '/repos/:id/onboarding-tour/shares',
    { schema: { params: IdParams, response: { 200: ShareList } } },
    async (req, reply) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      try {
        reply.header('Cache-Control', 'no-store');
        return await gen.shares.list(workspaceId, userId, req.params.id);
      } catch (err) {
        return mapErrors(err);
      }
    },
  );

  app.delete(
    '/repos/:id/onboarding-tour/shares/:shareId',
    {
      schema: { params: ShareIdParams, response: { 200: ShareRevoked } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => bucketKey(app, req) } },
    },
    async (req) => {
      const { workspaceId, userId } = await getContext(app.container, req);
      try {
        return await gen.shares.revoke(workspaceId, userId, req.params.id, req.params.shareId);
      } catch (err) {
        return mapErrors(err);
      }
    },
  );

  // ---- the only anonymous endpoint: no auth context, generic 404, no caching, no referrer
  app.get(
    '/public/onboarding/:token',
    {
      schema: { params: TokenParams, response: { 200: PublicOnboardingSnapshot } },
      config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => `ip:${req.ip}` } },
    },
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Robots-Tag', 'noindex, nofollow');
      const token = ShareToken.safeParse(req.params.token);
      // Malformed, unknown and revoked tokens are indistinguishable.
      if (!token.success) throw new NotFoundError('This link is not available.');
      try {
        return await gen.shares.readPublic(token.data);
      } catch (err) {
        return mapErrors(err);
      }
    },
  );
}
