import type { CiExport, CiExportInput, CiFile, CiInstallation } from '@devdigest/shared';
import type { CiRepositoryPort } from '../ports/ci-repository.js';
import { GitHubExportError, type GitHubExportPort } from '../ports/github-export.js';
import type { IngestTokenPort } from '../ports/ingest-token.js';
import type { RunnerBundlePort } from '../ports/runner-bundle.js';
import { buildManifest, manifestToYaml, ManifestValidationError } from '../../domain/manifest.js';
import { uniqueSlug } from '../../domain/slug.js';
import { generateWorkflowYaml, RUNNER_ENTRY, WORKFLOW_PATH } from '../../domain/workflow.js';
import { CiError } from '../errors.js';

const EXPORT_BRANCH = 'devdigest/ci';
const PR_TITLE = 'Add DevDigest CI review';

export interface ExportCiDeps {
  repo: CiRepositoryPort;
  github: GitHubExportPort;
  token: IngestTokenPort;
  runnerBundle: RunnerBundlePort;
}

export interface ExportCiRequest {
  workspaceId: string;
  agentId: string;
  input: CiExportInput;
}

export interface ExportCiResult {
  export: CiExport;
  /** Plaintext ingest token — present ONLY when the installation was just
   *  created (shown to the member once, never persisted). `null` on re-export. */
  ingestToken: string | null;
}

/** Build the four generated file groups (AC-3). Pure assembly from manifest +
 *  skills + runner bundle; zero skills → no skill files (edge case). */
function buildFiles(
  manifestYaml: string,
  agentSlug: string,
  skillFiles: { slug: string; body: string }[],
  runnerBundle: string,
): CiFile[] {
  const files: CiFile[] = [
    { path: `.devdigest/agents/${agentSlug}.yaml`, contents: manifestYaml, editable: true },
  ];
  for (const s of skillFiles) {
    files.push({ path: `.devdigest/skills/${s.slug}.md`, contents: s.body, editable: true });
  }
  files.push({ path: RUNNER_ENTRY, contents: runnerBundle, editable: false });
  files.push({ path: WORKFLOW_PATH, contents: generateWorkflowYaml(), editable: true });
  return files;
}

/**
 * Export-to-CI use-case (AC-2..AC-8). Serializes the agent to an `AgentManifest`
 * (AC-4), builds the four file groups (AC-3), commits them to `devdigest/ci` and
 * opens/reuses the PR (AC-5), persists one installation per `(agent, repo)` with
 * a hashed ingest token (AC-7), and NEVER writes the default branch. On GitHub
 * failure nothing is persisted (AC-6: write ordering — GitHub first, DB after).
 */
export function createExportCi(deps: ExportCiDeps) {
  return async function exportCi(req: ExportCiRequest): Promise<ExportCiResult> {
    const agent = await deps.repo.getExportableAgent(req.workspaceId, req.agentId);
    if (!agent) throw new CiError('agent_not_found', 'Agent not found');

    // 1. Resolve skill slugs (kebab-case of name, deduped) + serialize manifest.
    const taken = new Set<string>();
    const skillFiles = agent.skills.map((s) => ({ slug: uniqueSlug(s.name, taken), body: s.body }));
    const agentSlug = uniqueSlug(agent.name, new Set<string>());

    let manifestYaml: string;
    try {
      const manifest = buildManifest({
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        skillSlugs: skillFiles.map((s) => s.slug),
        strategy: agent.strategy,
        ciFailOn: agent.ciFailOn,
      });
      manifestYaml = manifestToYaml(manifest);
    } catch (err) {
      if (err instanceof ManifestValidationError) {
        throw new CiError('manifest_invalid', err.message);
      }
      throw err;
    }

    // 2. Read the bundled runner (R3). Missing → clear "export unavailable".
    let runnerBundle: string;
    try {
      runnerBundle = deps.runnerBundle.read();
    } catch (err) {
      throw new CiError(
        'export_unavailable',
        `Export unavailable: the CI runner bundle could not be located (${(err as Error).message}). Build agent-runner first.`,
      );
    }

    const files = buildFiles(manifestYaml, agentSlug, skillFiles, runnerBundle);

    // AC-2 preview: `action: "files"` returns the generated file contents only —
    // NO GitHub write (no commit / no PR), NO installation upsert, NO token.
    if (req.input.action === 'files') {
      return { export: { installation: null, files, pr_url: null }, ingestToken: null };
    }

    // 3. Commit to the dedicated branch + reuse/open the PR (AC-5). On any
    //    GitHub failure we throw before touching the DB (AC-6).
    let prUrl: string | null;
    try {
      await deps.github.commitFiles({
        repo: req.input.repo,
        branch: EXPORT_BRANCH,
        base: req.input.base,
        message: PR_TITLE,
        files: files.map((f) => ({ path: f.path, contents: f.contents })),
      });
      const existing = await deps.github.findOpenPr(req.input.repo, EXPORT_BRANCH);
      prUrl =
        existing?.url ??
        (
          await deps.github.openPullRequest({
            repo: req.input.repo,
            title: PR_TITLE,
            head: EXPORT_BRANCH,
            base: req.input.base,
            body: 'Adds the DevDigest review agent (manifest, skills, bundled runner, workflow).',
          })
        ).url;
    } catch (err) {
      if (err instanceof GitHubExportError) throw new CiError('github_failed', err.message);
      throw err;
    }

    // 4. Persist the installation (AC-7): hashed token on first create, keep the
    //    existing token on re-export. Only a freshly created installation yields
    //    a plaintext token to show the member once.
    const generated = deps.token.generate();
    const { row, created } = await deps.repo.upsertInstallation({
      agentId: agent.id,
      repo: req.input.repo,
      targetType: req.input.target,
      tokenHash: generated.hash,
    });

    const installation: CiInstallation = {
      id: row.id,
      agent_id: row.agentId,
      repo: row.repo,
      target_type: row.targetType,
      installed_at: (row.installedAt ?? new Date()).toISOString(),
    };

    return {
      export: { installation, files, pr_url: prUrl },
      ingestToken: created ? generated.plaintext : null,
    };
  };
}
