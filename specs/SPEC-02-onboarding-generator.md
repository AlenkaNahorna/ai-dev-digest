# Spec: Onboarding Generator
Spec ID: SPEC-02
Status: draft

## Problem and user
A developer joining an unfamiliar repository needs a dependable starting point before making changes. Architecture, entrypoints, setup instructions, and suitable first tasks are scattered across code and documentation. Onboarding Generator turns repo-intel evidence and repository documentation into an LLM-generated tour, and lets its owner explicitly publish a revocable snapshot.

## Goals / Non-goals
- G1: Explain the repository through five ordered parts: architecture overview, critical paths, local run, guided reading path, and first tasks.
- G2: Generate automatically after a usable index completes, supporting manual Regenerate with progress and failure feedback.
- G3: Ground the tour in its indexed revision and available documentation; expose incomplete evidence rather than inventing facts.
- G4: Persist readable results and share immutable public snapshots with owner-controlled revocation.
- Non-goals: executing setup commands, modifying repositories, creating issues for suggested tasks, public access to repository source, deployment/tunnels, and replacing the existing `/onboarding` repository-import flow.

## User stories
- As a new contributor, I can follow the tour from architecture through a small first task without guessing which files to read.
- As the repository owner, I can share the exact tour I reviewed and revoke its link later without changing the private tour.

## Acceptance criteria (EARS)
- AC-1: WHEN a workspace member opens a repository's Onboarding Tour navigation item, the system shall display that repository's persisted tour state.
- AC-2: WHEN indexing completes with a usable `full` or `partial` index, the system shall request automatic generation from that completed index revision.
- AC-3: IF the index has no usable repository evidence, THEN the system shall show an unavailable state explaining that indexing is required.
- AC-4: WHEN generation is requested, the system shall provide the LLM with bounded repo-intel evidence and readable repository documentation from the source revision.
- AC-5: WHEN the owner selects Regenerate, the system shall request a new tour from the latest usable indexed revision.
- AC-6: WHILE generation is pending, the system shall display a pending generation state.
- AC-7: WHEN generation succeeds, the system shall persist the validated result as the latest successful tour.
- AC-8: IF generation fails, THEN the system shall display a safe failure explanation with a retry action.
- AC-9: WHILE regeneration is pending or has failed, the system shall retain the last successful tour for reading.
- AC-10: IF an older generation finishes after a newer request superseded it, THEN the system shall prevent that older result from replacing the current tour.
- AC-11: WHEN a successful tour is displayed, the system shall present the five sections in the order architecture overview, critical paths, local run, guided reading path, and first tasks.
- AC-12: WHEN architecture evidence is available, the system shall display an architecture summary and diagram grounded in that evidence.
- AC-13: WHEN critical paths are displayed, the system shall show repository-relative paths with explanations of their roles.
- AC-14: WHEN local-run guidance is displayed, the system shall show ordered setup commands or instructions grounded in repository documentation or configuration.
- AC-15: WHEN the user selects a local-run command's Copy action, the system shall copy that displayed command to the clipboard.
- AC-16: WHEN the guided reading path is displayed, the system shall show numbered files with explanations of why they belong at their positions.
- AC-17: WHEN first tasks are displayed, the system shall identify them as suggestions with relevant files and checkable completion outcomes.
- AC-18: WHEN the user selects a critical-path Open action or a reading-path file link, the system shall open the repository file at the tour's source commit.
- AC-19: WHEN the user selects an On this page item, the system shall navigate to its corresponding section.
- AC-20: WHEN the user toggles a section heading, the system shall toggle that section's expanded state.
- AC-21: WHEN a tour is displayed, the system shall identify its source commit, source index timestamp, generation timestamp, and source index completeness.
- AC-22: IF a section lacks supporting evidence, THEN the system shall show an explicit evidence-unavailable explanation in that section.
- AC-23: IF the current usable index revision differs from the displayed tour's source revision, THEN the system shall identify the displayed tour as out of date.
- AC-24: WHEN the repository owner selects Share link on a successful tour, the system shall create an immutable snapshot of that displayed tour under an unguessable public link.
- AC-25: WHEN a visitor opens an active public share link without signing in, the system shall display only its stored tour snapshot and snapshot provenance.
- AC-26: WHEN the private tour changes, the system shall preserve the contents of existing public snapshots.
- AC-27: WHEN the snapshot owner revokes a share, the system shall deny subsequent public reads of that snapshot.
- AC-28: IF a share link is invalid or revoked, THEN the system shall display a safe unavailable state without revealing private repository data.
- AC-29: WHEN share creation or revocation finishes, the system shall display its success or failure outcome.
- AC-30: IF a requester lacks required workspace access or share ownership, THEN the system shall deny private tour operations or share management respectively.
- AC-31: WHEN a visitor follows a source reference on a public snapshot, the system shall preserve the repository provider's existing source-access restrictions.
- AC-32: WHILE a tour is being read or its status refreshed, the system shall serve persisted data without invoking the LLM.

## Edge cases
- Empty repository, missing clone, failed/degraded indexing, or `partial` with no usable evidence: AC-3; a status string alone does not establish usable evidence.
- Partial index, missing docs, unsupported languages, empty graph/rank output, unreadable or excluded documents: preserve the five sections and explain unavailable evidence (AC-22), including a diagram fallback when no graph can be supported.
- Initial load without a tour differs from regeneration with an existing tour; pending/failure states retain existing readable content.
- Concurrent automatic/manual requests and revision changes must not publish obsolete completions over newer results. Repeated reads do not create generation work.
- Large repositories require bounded evidence/output. Limits belong to the plan; truncation must be reported rather than representing sampled evidence as exhaustive.
- Copy failure must produce visible feedback. A file unavailable at the stored revision must yield a safe unavailable result rather than silently opening the current branch.
- Sharing is explicit publication; automatic generation never publishes a share. Public snapshots contain tour content, not raw input documents, credentials, private workspace navigation, or privileged source-reading endpoints.
- Revocation prevents future server reads; it cannot erase copies already downloaded. Responses must not be cached in a way that permits new reads after revocation.
- Public links use the configured externally reachable application origin. Localhost is not an internet deployment; environment deployment is outside feature scope.

## Non-functional requirements
- Security: apply `.claude/skills/security/SKILL.md` A01 access control, A05 injection prevention, A06 bounded AI generation, A09 secret-safe logging, and agentic input/tool isolation, adapted to Fastify/Zod/PostgreSQL. Verify with unauthorized workspace/ownership requests, hostile Markdown/URLs/diagram labels, traversal attempts, prompt-injection fixtures, secret fixtures, and revoked-link reads.
- Accessibility: navigation, collapse, file links, Copy, Regenerate, Share, and Revoke work by keyboard with named controls and visible feedback; verify by keyboard walkthrough and component assertions. Provide a readable textual architecture summary alongside the diagram.
- Resource bounds: generation enforces finite evidence/output sizes and request timeouts; verify oversized input and an unresponsive LLM. Exact engineering budgets belong to the plan.
- Observability: expose generation state, source revision, and safe failure category without logging raw repository documents, secrets, or share credentials; verify transitions and redacted logs.
- Durability: successful tours, snapshots, and revocations survive restart; verify restart reads and transactional failure behavior.

## Inputs and provenance
- User decisions: LLM + repo-intel + repository documentation; automatic generation after indexing; separate implementation/review agents; public snapshots frozen at Share time with owner revocation.
- Design sources: two attached DevDigest screenshots specify navigation, five ordered cards, architecture diagram, critical-path Open actions, numbered commands with Copy, numbered reading recommendations, On this page links, section collapse, Regenerate, and Share link. Sample paths, technologies, credentials, counts, and commands are illustrations, not requirements for every repository.
- Existing producers: repo-intel full/incremental pipelines persist `repo_index_state`; its repository and `getIndexState` expose `lastIndexedSha`, `updatedAt`, and `status`. `getRepoMap`, `getTopFilesByRank`, `getCriticalPaths`, and symbol/reference methods provide code evidence. Index handlers currently complete indexing without onboarding generation; this feature adds the follow-up behavior.
- `filesIndexed` accumulates across incremental passes and is not a verified current unique-file inventory. Replace the screenshot's “12,450 files” with truthful source commit/index timestamp metadata. Project Context's listing timestamp is not code-index completion time.
- Documentation is untrusted repository-controlled material read from the cloned repository at the selected revision. The feature must work independently of the unrelated uncommitted Project Context implementation.
- Capture source metadata when generation starts and persist it with the tour. Generation timestamps and lifecycle states are new feature-owned producers.
- Diagram, summaries, ordered paths, setup instructions, and tasks are new validated LLM output backed by captured evidence. A suggested task does not imply an existing issue or proven defect.
- Public snapshots persist the displayed successful tour's content and provenance separately from the evolving private result.

## Untrusted inputs
- Validate repository IDs, request bodies, paths, tokens, and generated structured output at server boundaries. Scope private operations to the requester workspace; require share-owner identity for revocation. Only snapshot reads are anonymous.
- Treat repository files and LLM output as data, never authority over system instructions. Generation cannot execute suggested commands or give the LLM tools to access arbitrary host files, secrets, or repository mutations.
- Keep document paths within the selected repository; reject traversal and unsafe links. Render Markdown/diagram labels without executable HTML or script URLs; constrain external navigation to allowed schemes.
- Keep credentials server-side. Exclude secrets and credential-bearing documents from evidence/public content. Public responses never include raw prompts, host clone paths, or internal error stacks; logs redact credentials/share tokens.
- Apply bounded validation, timeouts, and rate limits under existing API policy. Public reads cannot trigger generation or private source retrieval.

## Open questions
- Architecture impact: add an onboarding capability spanning server generation/persistence and client tour/public views; indexing completion communicates a captured revision to generation. Share reads are an explicit anonymous, snapshot-only exception to the authenticated workspace boundary. Contracts remain in the canonical server-owned shared source. The planner documents this impact without editing this spec's human-owned status.
- Proposal: show the exact content being published before copying the public link so owners can review disclosure. The screenshots do not specify a separate confirmation flow.
- Proposal: optional retention/expiration controls can follow later; this version promises persistence and explicit revocation without inventing an expiration duration.

## Traceability
- G1 → AC-1, AC-11–AC-20.
- G2 → AC-2–AC-10, AC-32.
- G3 → AC-4, AC-12–AC-18, AC-21–AC-23, AC-31.
- G4 → AC-7, AC-9, AC-24–AC-31.
- All criteria trace to these goals or supplied design; no unresolved load-bearing clarification remains.
