import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CompareQuery,
  EvalCaseDraft,
  EvalCaseOverrides,
  EvalBatchDetail,
  EvalBatchList,
  EvalCaseList,
  EvalCaseRecord,
  EvalCompare,
  EvalImportResult,
  EvalOverview,
  EvalTryInput,
  EvalTryResult,
  SkillEvalCaseInput,
  SkillEvalCaseList,
  SkillEvalCaseRecord,
  SkillPairResult,
  SkillRunSummary,
} from '@devdigest/shared';
import { z } from 'zod';
import { getContext } from '../../../../_shared/context.js';
import { IdParams } from '../../../../_shared/schemas.js';
import { AppError, NotFoundError } from '../../../../../platform/errors.js';
import { EvalError } from '../../../application/errors.js';
import type { EvalLogPort } from '../../../application/ports/eval-ports.js';
import { createCaseFromFinding, createDeleteCase, createImportFromDecisions, createListCases, createManualCase, createRunStoredCase, createTryCase, createUpdateCase } from '../../../application/use-cases/cases.js';
import { createCompare, createGetBatch, createListBatches, createOverview, createRunBatch } from '../../../application/use-cases/batches.js';
import {
  createListSkillCases,
  createRunSkillCase,
  createRunSkillEvals,
  createSkillCase,
  createTrySkillCase,
} from '../../../application/use-cases/skill-evals.js';
import { SkillConfig } from '../../outbound/providers/skill-config.js';
import { EvalRepository } from '../../outbound/persistence/eval.repository.js';
import { AgentConfig } from '../../outbound/providers/agent-config.js';
import { FindingSource } from '../../outbound/providers/finding-source.js';
import { ReviewerCoreRunner } from '../../outbound/providers/reviewer-core-runner.js';

const STATUS: Record<EvalError['kind'], number> = {
  not_found: 404,
  finding_undecided: 422,
  finding_without_agent: 422,
  eval_case_exists: 409,
  diff_unavailable: 409,
  no_eval_cases: 422,
  batches_mismatch: 422,
  skill_not_linked: 422,
};

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof EvalError) {
      if (err.kind === 'not_found') throw new NotFoundError(err.message);
      throw new AppError(err.kind, err.message, STATUS[err.kind]);
    }
    throw err;
  }
}

function requestLog(req: FastifyRequest): EvalLogPort {
  return { warn: (msg, fields) => req.log.warn(fields, msg) };
}

/**
 * Eval pipeline routes (all workspace-scoped, params validated with Zod).
 *
 *   GET    /findings/:id/eval-case-draft  → the seeded case for the modal (nothing stored)
 *   POST   /findings/:id/eval-case        → case from an accepted/dismissed finding (optional edits; no model call)
 *   POST   /agents/:id/eval-cases/try     → "Run case": one run on a draft, scored in code, not stored
 *   GET    /agents/:id/eval-cases         → the agent's cases + latest pass/fail
 *   POST   /agents/:id/eval-cases/import  → cases from every decided finding of the agent (P2)
 *   PATCH  /eval-cases/:id                → edit a stored case
 *   POST   /eval-cases/:id/run            → run one stored case (latest result only, no batch)
 *   DELETE /eval-cases/:id                → delete a case and its run rows
 *   POST   /agents/:id/eval-runs          → run the agent on all its cases (one batch)
 *   GET    /agents/:id/eval-runs          → batch history, newest first
 *   GET    /eval-runs/compare?a=&b=       → two batches side by side
 *   GET    /eval-runs/:id                 → one batch with per-case results
 *   GET    /eval/overview                 → Eval Dashboard data
 *   GET|POST /skills/:id/eval-cases       → skill cases (hand-written) with the latest with / without result
 *   POST   /skills/:id/eval-cases/try     → "Run case" on a skill draft (both sides, not stored)
 *   POST   /skills/:id/eval-cases/:caseId/run → run one skill case
 *   POST   /skills/:id/eval-runs          → run every skill case with and without the skill
 */
export default async function evalPipelineRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const store = new EvalRepository(container.db);
  const agents = new AgentConfig(container);
  const findings = new FindingSource(container);
  const runner = new ReviewerCoreRunner(container);
  const skills = new SkillConfig(container);
  const skillDeps = (req: FastifyRequest) => ({ store, skills, runner, log: requestLog(req) });
  const deps = (req: FastifyRequest) => ({ store, agents, findings, runner, log: requestLog(req) });

  // The modal opens with this: nothing is stored, no model is called.
  app.get(
    '/findings/:id/eval-case-draft',
    { schema: { params: IdParams, response: { 200: EvalCaseDraft } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createCaseFromFinding(deps(req)).draftFromFindingId(workspaceId, req.params.id));
    },
  );

  // No body → the seeded case (one click); a body carries the edits made in the modal.
  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, body: EvalCaseOverrides.nullish(), response: { 201: EvalCaseRecord } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const created = await guard(() =>
        createCaseFromFinding(deps(req)).fromFindingId(workspaceId, req.params.id, req.body ?? undefined),
      );
      return reply.code(201).send(created);
    },
  );

  // Hand-written case from the "New eval case" button.
  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: SkillEvalCaseInput, response: { 201: EvalCaseRecord } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const created = await guard(() => createManualCase(deps(req))(workspaceId, req.params.id, req.body));
      return reply.code(201).send(created);
    },
  );

  // "Run case": one model call on a draft, scored in code, never stored.
  app.post(
    '/agents/:id/eval-cases/try',
    {
      schema: { params: IdParams, body: EvalTryInput, response: { 200: EvalTryResult } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createTryCase(deps(req))(workspaceId, req.params.id, req.body));
    },
  );

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: EvalCaseList } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createListCases(deps(req))(workspaceId, req.params.id));
    },
  );

  app.post(
    '/agents/:id/eval-cases/import',
    { schema: { params: IdParams, response: { 200: EvalImportResult } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createImportFromDecisions(deps(req))(workspaceId, req.params.id));
    },
  );

  // Edit a stored case (name, diff fragment, expectation).
  app.patch(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseOverrides, response: { 200: EvalCaseRecord } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createUpdateCase(deps(req))(workspaceId, req.params.id, req.body));
    },
  );

  // Run ONE stored case; the result becomes its latest result but never enters batch history.
  app.post(
    '/eval-cases/:id/run',
    { schema: { params: IdParams, response: { 200: EvalTryResult } }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createRunStoredCase(deps(req))(workspaceId, req.params.id));
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    await guard(() => createDeleteCase(deps(req))(workspaceId, req.params.id));
    return reply.code(204).send();
  });

  // Each press costs one model call per case → tight per-route limit (AC-19).
  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: EvalBatchDetail } }, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createRunBatch(deps(req))(workspaceId, req.params.id));
    },
  );

  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: EvalBatchList } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createListBatches(deps(req))(workspaceId, req.params.id));
    },
  );

  app.get(
    '/eval-runs/compare',
    { schema: { querystring: CompareQuery, response: { 200: EvalCompare } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createCompare(deps(req))(workspaceId, req.query.a, req.query.b));
    },
  );

  app.get(
    '/eval-runs/:id',
    { schema: { params: IdParams, response: { 200: EvalBatchDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createGetBatch(deps(req))(workspaceId, req.params.id));
    },
  );

  app.get('/eval/overview', { schema: { response: { 200: EvalOverview } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return createOverview(deps(req))(workspaceId);
  });

  // ---- Skill evals (optional feature): the same case model, judged with vs without the skill ----------
  const SkillCaseParams = z.object({ id: z.string().uuid(), caseId: z.string().uuid() });

  app.get(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: SkillEvalCaseList } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createListSkillCases(skillDeps(req))(workspaceId, req.params.id));
    },
  );

  app.post(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams, body: SkillEvalCaseInput, response: { 201: SkillEvalCaseRecord } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const created = await guard(() => createSkillCase(skillDeps(req))(workspaceId, req.params.id, req.body));
      return reply.code(201).send(created);
    },
  );

  // "Run case" in the modal: both sides on a draft, nothing stored.
  app.post(
    '/skills/:id/eval-cases/try',
    { schema: { params: IdParams, body: EvalTryInput, response: { 200: SkillPairResult } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createTrySkillCase(skillDeps(req))(workspaceId, req.params.id, req.body));
    },
  );

  app.post(
    '/skills/:id/eval-cases/:caseId/run',
    { schema: { params: SkillCaseParams, response: { 200: SkillPairResult } }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createRunSkillCase(skillDeps(req))(workspaceId, req.params.id, req.params.caseId));
    },
  );

  // Every case × two model calls → tight limit.
  app.post(
    '/skills/:id/eval-runs',
    { schema: { params: IdParams, response: { 200: SkillRunSummary } }, config: { rateLimit: { max: 4, timeWindow: '1 minute' } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return guard(() => createRunSkillEvals(skillDeps(req))(workspaceId, req.params.id));
    },
  );
}
