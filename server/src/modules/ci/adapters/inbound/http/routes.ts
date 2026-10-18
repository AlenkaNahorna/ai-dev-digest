import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CiExportInput, CiResultArtifact } from '@devdigest/shared';
import { getContext } from '../../../../_shared/context.js';
import { IdParams } from '../../../../_shared/schemas.js';
import { CiError } from '../../../application/errors.js';
import { createExportCi } from '../../../application/use-cases/export.js';
import { createIngest } from '../../../application/use-cases/ingest.js';
import { createListInstallations } from '../../../application/use-cases/list-installations.js';
import { createListCiRuns } from '../../../application/use-cases/list-ci-runs.js';
import { CiRepository } from '../../outbound/persistence/ci.repository.js';
import { GitHubExportAdapter } from '../../outbound/providers/github-export.js';
import { CryptoIngestToken } from '../../outbound/providers/ingest-token.js';
import { FileRunnerBundle } from '../../outbound/providers/runner-bundle.js';

/**
 * Export-to-CI module routes (onion inbound/http). Handlers stay thin: Zod
 * validation → use-case → map result/status. All but the ingest route resolve
 * the workspace via `getContext` and are scoped to it (AC-20). The ingest route
 * is the ONE exception: it is authenticated by the per-installation hashed
 * bearer token, NOT by workspace auth (AC-15).
 *
 *   GET  /agents/:id/ci-installations   → CI tab list (AC-1, workspace-scoped)
 *   POST /agents/:id/export-ci          → export (AC-2..AC-8, workspace-scoped)
 *   GET  /ci-runs                       → 50 recent runs (AC-19, workspace-scoped)
 *   POST /ci/ingest                     → ingest (AC-15..AC-18, token-authed)
 */

/** 422 `error_code` surfaced to the UI for export-stage failures. */
function exportErrorStatus(kind: CiError['kind']): number {
  switch (kind) {
    case 'agent_not_found':
      return 404;
    case 'manifest_invalid':
      return 422;
    case 'export_unavailable':
      return 503;
    case 'github_failed':
      return 502;
    default:
      return 422;
  }
}

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  const repo = new CiRepository(app.container.db);
  const token = new CryptoIngestToken();
  const runnerBundle = new FileRunnerBundle();

  const listInstallations = createListInstallations(repo);
  const listCiRuns = createListCiRuns(repo);
  const ingest = createIngest({ repo, token });

  // --- CI tab: installations for an agent (AC-1) --------------------------
  app.get('/agents/:id/ci-installations', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return listInstallations(workspaceId, req.params.id);
  });

  // --- Export (AC-2..AC-8) -------------------------------------------------
  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: CiExportInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      // GitHub client is resolved per-request from the DI container and wrapped
      // by the outbound adapter — the use-case only sees the narrow port.
      const github = new GitHubExportAdapter(await app.container.github());
      const exportCi = createExportCi({ repo, github, token, runnerBundle });
      try {
        const result = await exportCi({
          workspaceId,
          agentId: req.params.id,
          input: req.body,
        });
        // The plaintext ingest token is returned ONCE, only on first install
        // (AC-7); on re-export it is null and the member keeps the old token.
        return { ...result.export, ingest_token: result.ingestToken };
      } catch (err) {
        if (err instanceof CiError) {
          reply.status(exportErrorStatus(err.kind));
          return { error: err.kind, message: err.message };
        }
        throw err;
      }
    },
  );

  // --- CI Runs list (AC-19) ------------------------------------------------
  app.get('/ci-runs', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return listCiRuns(workspaceId);
  });

  // --- Ingest (AC-15..AC-18): bearer-token authed, NOT workspace auth ------
  app.post('/ci/ingest', { schema: { body: CiResultArtifact } }, async (req, reply) => {
    const auth = req.headers.authorization;
    const bearer = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : undefined;
    try {
      const result = await ingest({ bearer, artifact: req.body });
      return { ok: true, deduped: result.deduped };
    } catch (err) {
      if (err instanceof CiError) {
        // Generic rejection for every auth/payload failure (AC-15) — no detail
        // leaks whether the token was unknown vs the repo mismatched.
        reply.status(err.kind === 'unauthorized' ? 401 : 422);
        return { error: 'invalid_request' };
      }
      throw err;
    }
  });
}
