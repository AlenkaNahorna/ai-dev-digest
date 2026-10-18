import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RunRequest } from '@devdigest/shared';
import type { RunEvent } from '@devdigest/shared';
import { getContext } from '../../../../_shared/context.js';
import { IdParams } from '../../../../_shared/schemas.js';
import { NotFoundError } from '../../../../../platform/errors.js';
import { ReviewService } from '../../../service.js';
import { responseSchemas } from '../../../../_shared/response-schemas.js';
import { MAX_AGENTS, MIN_AGENTS } from '../../../multi-agent/constants.js';

const RunRequestBody = RunRequest.default({});

/** 1..MAX_AGENTS distinct agent ids; empty/out-of-range/duplicate → 422 before the handler. */
const AgentIds = z
  .array(z.string().min(1))
  .min(MIN_AGENTS)
  .max(MAX_AGENTS)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'agent_ids must be unique' });

/** Non-empty, 1..MAX_AGENTS unique agent-id array; invalid → 422 before the handler. */
const MultiAgentStartBody = z.object({ agent_ids: AgentIds });

/** Parent-run read params: PR id + parent id. */
const MultiAgentParentParams = z.object({ id: z.string(), parentId: z.string() });

/** Estimate request: the agent ids the user has selected (1..MAX_AGENTS, unique). */
const MultiAgentEstimateBody = z.object({ agent_ids: AgentIds });

/**
 * reviews module.
 *   POST   /pulls/:id/review  {agentId} | {all:true}  → run review(s); returns runs
 *   GET    /runs/:id/events                            → SSE stream of RunEvent (replay-first)
 *   GET    /runs/:id/trace                             → the single-document RunTrace
 *   GET    /pulls/:id/reviews                          → persisted reviews + findings for a PR
 *   GET    /pulls/:id/smart-diff                       → files grouped by role + finding lines (no LLM)
 *   GET    /pulls/:id/intent                           → persisted PR intent (+stale flag) or null
 *   POST   /pulls/:id/intent                           → (re)derive the intent with the cheap classifier model
 *   POST   /findings/:id/(accept|dismiss)              → finding actions
 */
const FINDING_ACTIONS = ['accept', 'dismiss'] as const;
export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);

  // ---- Run a review (manual trigger) -------------------------------
  // Tight per-route limit: each call can fan out to expensive LLM runs.
  // Body stays a tolerant manual parse (both fields optional; empty body is OK).
  app.post(
    '/pulls/:id/review',
    { schema: { params: IdParams, body: RunRequestBody, response: { 200: responseSchemas.reviewRun } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = req.body;
    const targets = await service.resolveTargets(workspaceId, {
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.all !== undefined ? { all: body.all } : {}),
    });
    const { runs, reviews } = await service.runReview(
      workspaceId,
      req.params.id,
      targets,
      req.log,
    );
    return { pr_id: req.params.id, runs, reviews };
  });

  // ---- Multi-agent review: start one parent-grouped run -------------------
  // Own tight rate limit (fans out to N expensive LLM runs). 409 while a run
  // on the PR is active; 422 on an out-of-range agent set.
  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: {
        params: IdParams,
        body: MultiAgentStartBody,
        response: { 200: responseSchemas.multiAgentStart },
      },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.startMultiAgentRun(workspaceId, req.params.id, req.body.agent_ids, req.log);
    },
  );

  // ---- Multi-agent review: results read-model (columns/groups/conflicts) --
  app.get(
    '/pulls/:id/multi-agent/:parentId',
    { schema: { params: MultiAgentParentParams, response: { 200: responseSchemas.multiAgentRun } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getMultiAgentRun(workspaceId, req.params.parentId);
    },
  );

  // ---- Multi-agent review: pre-run estimate (mean duration + cost) --------
  app.post(
    '/pulls/:id/multi-agent/estimate',
    { schema: { params: IdParams, body: MultiAgentEstimateBody, response: { 200: responseSchemas.multiAgentEstimate } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.estimateMultiAgent(workspaceId, req.body.agent_ids);
    },
  );

  // ---- SSE: live run events (replay buffer first, then live; ends on done) -
  // No rate limit: SSE is one long-lived connection, not burst traffic.
  app.get(
    '/runs/:id/events',
    { schema: { params: IdParams }, config: { rateLimit: false } },
    async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const runId = req.params.id;
    await service.ensureRunAccess(workspaceId, runId);

    reply.sse(
      (async function* () {
        // Bridge the in-memory RunBus to an async iterator the SSE plugin drains.
        const queue: RunEvent[] = [];
        let resolve: (() => void) | null = null;
        let done = false;

        const unsubscribe = container.runBus.subscribe(runId, (e) => {
          queue.push(e);
          resolve?.();
        });
        const offDone = container.runBus.onDone(runId, () => {
          done = true;
          resolve?.();
        });

        try {
          while (true) {
            if (queue.length === 0) {
              if (done) break;
              await new Promise<void>((r) => (resolve = r));
              resolve = null;
              continue;
            }
            const e = queue.shift()!;
            yield {
              id: String(e.seq),
              event: e.kind,
              data: JSON.stringify(e),
            };
          }
        } finally {
          unsubscribe();
          offDone();
        }
      })(),
    );
  });

  // ---- Active (in-flight) runs for a PR (server source of truth) ----------
  app.get('/pulls/:id/runs/active', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.activeRuns(workspaceId, req.params.id);
  });

  // ---- All runs for a PR (any status; the run history, incl. failures) -----
  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  // ---- Delete one run from the history (+ its trace) ----------------------
  app.delete('/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteRun(workspaceId, req.params.id);
    return { ok };
  });

  // ---- Cancel an in-flight run --------------------------------------------
  app.post('/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    await service.cancelRun(workspaceId, req.params.id);
    return { ok: true };
  });

  // ---- Run trace (single document; A5 enriches with multi-agent/stats) ----
  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const trace = await service.getRunTrace(workspaceId, req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });

  // ---- Reads --------------------------------------------------------------
  app.get('/pulls/:id/reviews', { schema: { params: IdParams, response: { 200: responseSchemas.reviews } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.reviewsForPull(workspaceId, req.params.id);
  });

  // ---- Smart Diff (pure DB read, no LLM) ----------------------------------
  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams, response: { 200: responseSchemas.smartDiff } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.smartDiffForPull(workspaceId, req.params.id);
  });

  // ---- Intent layer -------------------------------------------------------
  app.get('/pulls/:id/intent', { schema: { params: IdParams, response: { 200: responseSchemas.intent } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getIntent(workspaceId, req.params.id);
  });

  // Re-derive after the PR changed. One (cheap) LLM call → tight rate limit.
  app.post(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: responseSchemas.intentRecord } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.rederiveIntent(workspaceId, req.params.id, req.log);
    },
  );

  // ---- Delete a whole review run (one agent's pass) + its findings --------
  app.delete('/reviews/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteReview(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Review not found');
    return { ok: true };
  });

  // ---- Finding actions (accept / dismiss) ---------------------------------
  for (const action of FINDING_ACTIONS) {
    app.post(`/findings/:id/${action}`, { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.actOnFinding(workspaceId, req.params.id, action);
      return result;
    });
  }
}
