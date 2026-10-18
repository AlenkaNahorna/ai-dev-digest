import type { CiExport, CiExportInput, CiFile, CiInstallation } from '@devdigest/shared';
import type { CiRepositoryPort } from '../ports/ci-repository.js';
import { GitHubExportError, type GitHubExportPort } from '../ports/github-export.js';
import type { IngestTokenPort } from '../ports/ingest-token.js';
import type { RunnerBundlePort } from '../ports/runner-bundle.js';
import { buildManifest, manifestToYaml, ManifestValidationError } from '../../domain/manifest.js';
import { uniqueSlug } from '../../domain/slug.js';
import { memoryToJsonl } from '../../domain/memory.js';
import {
  assertWorkflowSafe,
  generateWorkflowYaml,
  MEMORY_PATH,
  RUNNER_ENTRY,
  RUNNER_PACKAGE_JSON,
  RUNNER_PACKAGE_JSON_CONTENTS,
  WORKFLOW_PATH,
  WORKFLOW_VERSION,
} from '../../domain/workflow.js';
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

/**
 * Build the generated file groups (AC-3): manifest, skills, curated memory, the
 * bundled runner (+ its ESM marker) and the workflow. Pure assembly. Only the workflow is
 * `editable` in the wizard — manifest/skills/memory are authored in the studio
 * and the runner bundle is a build artifact. Zero skills → no skill files.
 */
function buildFiles(parts: {
  manifestYaml: string;
  agentSlug: string;
  skillFiles: { slug: string; body: string }[];
  memoryJsonl: string;
  runnerBundle: string;
  workflowYaml: string;
}): CiFile[] {
  const files: CiFile[] = [
    { path: `.devdigest/agents/${parts.agentSlug}.yaml`, contents: parts.manifestYaml, editable: false },
  ];
  for (const s of parts.skillFiles) {
    files.push({ path: `.devdigest/skills/${s.slug}.md`, contents: s.body, editable: false });
  }
  files.push({ path: MEMORY_PATH, contents: parts.memoryJsonl, editable: false });
  files.push({ path: RUNNER_ENTRY, contents: parts.runnerBundle, editable: false });
  files.push({ path: RUNNER_PACKAGE_JSON, contents: RUNNER_PACKAGE_JSON_CONTENTS, editable: false });
  files.push({ path: WORKFLOW_PATH, contents: parts.workflowYaml, editable: true });
  return files;
}

/** Apply Preview-step edits to editable files only; unknown/locked paths are ignored. */
function applyOverrides(files: CiFile[], overrides: Record<string, string>): CiFile[] {
  return files.map((f) => {
    const edited = overrides[f.path];
    if (!f.editable || edited === undefined) return f;
    if (edited.trim() === '') throw new CiError('manifest_invalid', `${f.path} cannot be empty`);
    if (f.path === WORKFLOW_PATH) {
      try {
        assertWorkflowSafe(edited);
      } catch (err) {
        throw new CiError('manifest_invalid', (err as Error).message);
      }
    }
    return { ...f, contents: edited };
  });
}

const SECRETS_NOTE = [
  '- Secret `OPENROUTER_API_KEY` — your model provider key.',
  '- Secret `DEVDIGEST_INGEST_TOKEN` — the one-time token shown in DevDigest after export.',
  '- Variable `DEVDIGEST_API_URL` — public base URL of the DevDigest API that GitHub can reach.',
].join('\n');

/** PR description: what is added + a reviewer checklist for the manual review. */
function buildPrBody(input: CiExportInput): string {
  return [
    'Adds a DevDigest review agent to this repository: manifest, skills, curated memory, the bundled runner and a GitHub Actions workflow.',
    '',
    `**Triggers:** \`pull_request\` → ${input.triggers.join(', ')}  `,
    `**Result is posted as:** ${input.post_as}`,
    '',
    '### Review before merging',
    '- `permissions` in the workflow are least-privilege (`contents: read`, `pull-requests` write only when a review/comment is posted).',
    '- Trigger is `pull_request` (never `pull_request_target`); PRs from forks are skipped so secrets are never exposed to fork code.',
    '- No `${{ github.event.* }}` is interpolated into a `run:` script; PR title/body/diff are read by the runner as data.',
    '- The runner is the committed, bundled `.devdigest/runner/index.js` — no unpublished external action is used.',
    '',
    '### Add before the first run (Settings → Secrets and variables → Actions)',
    SECRETS_NOTE,
    '',
    'To block merging on findings, set **Fail CI on** in DevDigest and make this check *required* in branch protection / rulesets.',
  ].join('\n');
}

/**
 * Export-to-CI use-case (AC-2..AC-8). Serializes the agent to an `AgentManifest`
 * (AC-4), builds the file groups (AC-3), commits them to `devdigest/ci` and
 * opens/reuses the PR (AC-5), persists one installation per `(agent, repo)` with
 * a hashed ingest token (AC-7), and NEVER writes the default branch. On GitHub
 * failure nothing is persisted (AC-6: write ordering — GitHub first, DB after).
 */
export function createExportCi(deps: ExportCiDeps) {
  return async function exportCi(req: ExportCiRequest): Promise<ExportCiResult> {
    // Only GitHub Actions has a generator. CircleCI/Jenkins/CLI exist in the
    // contract enum but are NOT implemented, so they are refused rather than
    // silently producing a GitHub workflow for the wrong target.
    if (req.input.target !== 'gha') {
      throw new CiError('unsupported_target', `Export target "${req.input.target}" is not supported yet`);
    }

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

    const memory = await deps.repo.listMemoryForExport(req.workspaceId, req.input.repo);
    const workflowYaml = generateWorkflowYaml({
      triggers: req.input.triggers,
      postAs: req.input.post_as,
    });
    const files = applyOverrides(
      buildFiles({
        manifestYaml,
        agentSlug,
        skillFiles,
        memoryJsonl: memoryToJsonl(memory),
        runnerBundle,
        workflowYaml,
      }),
      req.input.overrides,
    );

    // Preview: `action: "files"` returns the generated file contents only —
    // NO GitHub write (no commit / no PR), NO installation upsert, NO token.
    if (req.input.action === 'files') {
      return { export: { installation: null, files, pr_url: null }, ingestToken: null };
    }

    // 3. Commit to the dedicated branch + reuse/open the PR (AC-5). On any
    //    GitHub failure we throw before touching the DB (AC-6).
    let prUrl: string | null = null;
    // `zip` = hand-off without GitHub: nothing is written to the repo, but the
    // installation + one-time token are still created so results can be ingested.
    if (req.input.action === 'open_pr') {
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
              body: buildPrBody(req.input),
            })
          ).url;
      } catch (err) {
        if (err instanceof GitHubExportError) throw new CiError('github_failed', err.message);
        throw err;
      }
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
      workflowVersion: WORKFLOW_VERSION,
      postAs: req.input.post_as,
      triggers: req.input.triggers,
      prUrl,
    });

    const installation: CiInstallation = {
      id: row.id,
      agent_id: row.agentId,
      repo: row.repo,
      target_type: row.targetType,
      installed_at: (row.installedAt ?? new Date()).toISOString(),
      workflow_version: row.workflowVersion,
      latest_workflow_version: WORKFLOW_VERSION,
      post_as: row.postAs,
      triggers: row.triggers,
      pr_url: row.prUrl,
    };

    return {
      export: { installation, files, pr_url: prUrl },
      ingestToken: created ? generated.plaintext : null,
    };
  };
}
