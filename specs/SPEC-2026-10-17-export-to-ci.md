# Spec: Export to CI
Spec ID: SPEC-2026-10-17-export-to-ci
Status: approved (v1 = deliberately minimal; iterate after real user feedback)

## Problem and user
Today a DevDigest review agent runs only locally in the studio. Teams that want the same agent to
review every pull request automatically cannot do so without keeping the studio running. "Export to
CI" copies an agent into a target GitHub repository as versioned files and runs the review inside that
repository's own GitHub Actions on `pull_request` events, with results visible back in the studio.
The user is a workspace member who owns a review agent.

An agent is serialized to a manifest validated by the **same** canonical Zod schema (`AgentManifest`)
in the studio and in the bundled runner (`agent-runner`). "Same manifest" guarantees the same
configuration, not byte-identical review output.

## Scope principle (v1)
Smallest thing that works end to end: one target (GitHub Actions), one fixed workflow, one results
table. Anything configurable, optional, or defensive beyond security essentials is deferred (see
"Deferred to v2").

## Goals / Non-goals
- G1: A member exports an agent to a GitHub repo by opening a PR (on a dedicated branch, never the
  default branch) that adds the manifest, skill bodies, bundled runner, and a workflow.
- G2: One canonical Zod contract (`AgentManifest`) used by studio writer and CI runner.
- G3: The agent CI tab shows installations (repo + latest run outcome).
- G4: CI run results come back through an authenticated endpoint into `ci_runs` and show in a
  workspace "CI Runs" list.
- G5: The exported workflow is secure by construction (least-privilege token, secrets only in Actions
  Secrets, fork safety, untrusted input never in shell, no unpublished external action).
- Non-goals: other CI targets; a published GitHub Action; wizard configuration (triggers, post-as);
  zip export; branch-protection setup; writing to the default branch; running fork PR code.

## User stories
- As an agent owner, I click "Add to CI", pick a repository, see the files, and open a PR.
- As an agent owner, I re-run "Add to CI" on an installed repo to refresh the files via a PR.
- As a PR author in the target repo, the installed agent runs on my PR, posts its review, and fails
  the check when configured.
- As a member, I open "CI Runs" and see recent CI reviews with a link to the Actions job.

## Acceptance criteria (EARS)

### Export
- AC-1: WHEN a member opens the agent's CI tab, the system shall list its installations (repository,
  and the outcome and relative time of the latest CI run for each).
- AC-2: WHEN a member selects "Add to CI", the system shall open one dialog where they choose a target
  repository (`owner/name`) and see a preview of the files with contents, then confirm. GitHub Actions
  is the only target.
- AC-3: The files shall be: `.devdigest/agents/<slug>.yaml`, `.devdigest/skills/<slug>.md` per
  attached skill, the bundled runner `.devdigest/runner/index.js`, and
  `.github/workflows/devdigest-review.yml`.
- AC-4: The system shall serialize the agent with `AgentManifest` (name, provider, model, system
  prompt, skill slugs, strategy, `ci_fail_on`) and reject export if validation fails.
- AC-5: WHEN the member confirms, the system shall create or update the branch `devdigest/ci` in the
  target repo and open (or reuse the already open) PR titled "Add DevDigest CI review", and shall
  never write to the default branch.
- AC-6: IF the connected GitHub token cannot create branches/PRs in the target repo, THEN the system
  shall show a clear error and write nothing.
- AC-7: WHEN the PR is opened, the system shall persist one `ci_installation` per `(agent, repo)`
  (reconciling if it exists) and generate its ingest token (stored hashed, shown to the member once,
  to be added by them as the Actions Secret `DEVDIGEST_INGEST_TOKEN`). Re-running "Add to CI" on an
  installed repo refreshes the files in the same way and keeps the existing token.
- AC-8: The dialog shall list the secrets the member must add (`OPENROUTER_API_KEY`,
  `DEVDIGEST_INGEST_TOKEN`), plus the Actions variable `DEVDIGEST_API_URL` (public base URL of the
  studio API that GitHub can reach), and a short note that making the check *required* is done by the
  member in branch protection. The system shall never read, request, or display any secret value.

### Workflow (fixed, not configurable in v1)
- AC-9: The workflow shall trigger on `pull_request` types `opened`, `synchronize`, `reopened`, and
  invoke `node .devdigest/runner/index.js`; it shall not reference an unpublished external action.
- AC-10: The workflow shall post the review as a GitHub review, and the runner shall exit non-zero
  when the grounded findings meet the manifest's `ci_fail_on`. The verdict is derived
  deterministically from grounded findings, never from the model's self-reported verdict.
- AC-11: The workflow's `GITHUB_TOKEN` shall be limited to `contents: read` and
  `pull-requests: write`.
- AC-12: For fork PRs the job shall be skipped (no secrets exposed); the workflow shall never use
  `pull_request_target` with checkout of untrusted code.
- AC-13: The workflow shall never interpolate `${{ github.event.* }}` into `run:` scripts; PR
  diff/title/body/branch names are untrusted data. Any external action used shall be pinned to a full
  commit SHA.
- AC-14: Secrets (`OPENROUTER_API_KEY`, ingest token) shall appear only in Actions Secrets, never in
  the manifest, runner bundle, committed files, logs, or the result artifact.

### Ingest and CI Runs
- AC-15: At the end of a run the runner shall POST `devdigest-result.json` to
  `$DEVDIGEST_API_URL` with `Authorization: Bearer $DEVDIGEST_INGEST_TOKEN`. The system shall reject
  an unauthenticated, unknown-token, or invalid payload with a generic error.
- AC-16: The system shall validate the payload with `CiResultArtifact`, extended with `repository`,
  `commit_sha`, `run_id`, `run_attempt`, `verdict` (read by the runner from `GITHUB_*` env), and
  reject it if `repository` does not match the installation's repo.
- AC-17: WHEN valid, the system shall write one `ci_runs` row (installation, PR number, ran_at,
  verdict, findings count, severity counts, cost, duration, commit SHA, run id/attempt, Actions job
  URL). It shall not write `agent_runs`, `run_traces`, or `multi_agent_runs`.
- AC-18: IF the same `(installation, run_id, run_attempt)` is submitted again, THEN the system shall
  return success without creating a second row (unique index).
- AC-19: WHEN a member opens "CI Runs", the system shall show the 50 most recent workspace CI runs
  (`ran_at` desc, `id` desc) with repository, PR, agent, verdict, findings count, cost, duration, and
  a link to the Actions job; WHEN there are none, an empty state.
- AC-20: All export, CI-tab, and CI-Runs endpoints shall be scoped to the requester's workspace;
  every request body shall be validated with Zod.

## Edge cases
- Zero attached skills: `skills` is empty, no skill files in the preview.
- Branch `devdigest/ci` exists with an open PR: update it. Closed/merged PR: recreate the branch from
  the base.
- Hard runner failure (no artifact): nothing is ingested in v1; the failure is visible in the GitHub
  Actions check. Fork PR: skipped, nothing ingested.
- PR not resolvable at ingest: store `pr_number` as given; the row is still recorded.
- Ingest payload size bounded by the server body limit (default Fastify limit).

## Security (essentials kept in v1)
Workspace scoping (AC-20); Zod validation on every boundary (AC-15, AC-16, AC-20); hashed ingest
token with generic rejection; untrusted GitHub event data never in shell (AC-13); least-privilege
token (AC-11); fork safety (AC-12); no secret values in any file, log, or artifact (AC-14). Verified
by cross-workspace and unauthenticated-ingest tests and a scan of generated files for
`${{ github.event` inside `run:` and for secret fixtures.

## Inputs and provenance
- User-controlled: target repo, Install action (`CiExportInput`, with `triggers`/`post_as` fixed to
  the defaults in v1). Agent config is workspace-authored.
- Generated: manifest, skill files, bundled runner (`agent-runner` ncc build), workflow.
- Untrusted at CI time: PR diff, branch names, title/body, comments (wrapped by reviewer-core
  `wrapUntrusted` + `INJECTION_GUARD`).
- Existing producers: contracts `AgentManifest`, `CiExportInput`, `CiExport`, `CiInstallation`,
  `CiRun`, `CiResultArtifact`, `CiFailOn`, `CiTarget` in
  `server/src/vendor/shared/contracts/eval-ci.ts`; the `agent-runner` package (manifest load,
  grounded review, verdict, artifact, PR post, exit code); tables `ci_installations`, `ci_runs`
  (`server/src/db/schema/ci.ts`); nav key `ci-runs`.
- To build: the server `ci` module (export route, ingest route, CI-tab and CI-Runs reads, manifest
  writer, workflow generator); `ci_installations.token_hash`; new `ci_runs` columns (`verdict`,
  `commit_sha`, `run_id`, `run_attempt`, severity counts) + unique dedupe index; the extended
  artifact and the runner's POST step; the client CI tab and `/ci-runs` page.

## Cross-feature boundary (parallel worktree: multi-agent-review)
- This feature touches no `agent_runs`/`run_traces`/`multi_agent_runs` code, so it does not overlap
  with multi-agent-review's `runs.ts`, `observability.ts`, or `/multi-agent`.
- Remaining overlap: migration numbering and `_journal.json`. multi-agent-review takes `0019`, this
  feature `0020`; the second to merge rebases and regenerates with `drizzle-kit` (never edit the
  journal by hand). `server/src/modules/index.ts` and `client/.../helpers.ts` are append-only: on
  conflict keep both entries.

## Deferred to v2 (explicitly out of v1)
CircleCI/Jenkins/CLI targets; zip export; wizard steps and configurable triggers/post-as; secret
readiness status; workflow version display; mirroring CI runs into `agent_runs`; replay/out-of-order
protection; hard-failure envelope; pagination beyond 50; size bounds on manifest/skills; diff preview
for updates; token rotation.

## Open questions
- [NEEDS CLARIFICATION: there is no CI Runs page design; confirm columns, empty-state copy, and row
  link target. Default: the columns listed in AC-19, link opens the Actions job.]

## Traceability
- G1 → AC-2..AC-8. G2 → AC-4, AC-16. G3 → AC-1, AC-7. G4 → AC-15..AC-19. G5 → AC-9..AC-14, AC-20.
