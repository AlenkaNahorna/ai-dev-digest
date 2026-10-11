# Workflow retro ledger

## 2026-10-11 — SPEC-2026-10-11-project-context (in-context)
- Branch / plan: feature/L05-spec-driven-development; docs/plans/2026-10-11-project-context.md (plan only, nothing implemented yet)
- Tokens: unknown (not exposed in-session; context was compacted once, so the session was long)
- Agents (order): no subagents ran. Single session did spec-creator work → skill proposals → implementation-planner work. Multi-agent chain (implementer → reviewers ‖ plan-verifier → test-writer → pr-self-review) is planned, not executed.
- Difficulties: (1) AC-29 text replace missed due to line wrap, fixed with sed; (2) user's "which repo version" answer was a branch name, needed interpretation; (3) workflow-retro was only proposed via propose_skills, my reading of "all good" as saved was wrong, skill was missing later; (4) skill saved to disk is not loaded in the already-running session (Unknown skill), so the retro ran manually from SKILL.md; (5) AC-12 "chunks" had no data producer (code_chunks unwritten), found only at planning time.
- Easy: mirroring the blast module as the onion template; reusing reviewer-core specs/INJECTION_GUARD and RunTrace.specs_read; existing resync/index-state endpoints.
- Duplicated: AGENTS/INSIGHTS/skill files and run-executor re-read after compaction; plan risk entries edited twice (chunks, then wording); same chunk/token question surfaced in spec, plan and review of footer.
- Missed: feasibility check of every AC against existing data sources before spec approval (AC-12); confirming docs/retro/ledger.md format with user; stale plan risk text after spec amendment; no e2e flow.
- Recommendations (proposed, not applied):
  1. Add a "data-source check" step to spec-creator: each AC that shows a number must name its producer before status becomes approved.
  2. After propose_skills, wait for explicit "saved" and verify the file/list before relying on the skill; document "restart session to load new skills" in the skill README.
  3. When planner finds a spec gap, record it as a spec-amendment task and re-sync the plan in the same step to avoid stale risks.
  4. Have the session write a short handoff note before compaction (decisions, file paths) to avoid re-reading AGENTS/INSIGHTS.
  5. Capture per-agent token usage in implement-plan output so future retros are not "unknown".

## 2026-10-11 — SPEC-2026-10-11-pr-brief (in-context)
- Branch / plan: feature/L05-spec-driven-development; docs/plans/2026-10-11-pr-brief.md (steps 1-12 done, P3 step 13 not requested); changes uncommitted.
- Tokens: main session unknown (not exposed). Subagent totals as reported by the harness: implementer ~213k, test-writer ~242k, architecture-reviewer ~150k, security-reviewer ~149k, doc-writer ~91k, plan-verifier ~149k, pr-self-review ~132k, fix round ~117k; sum ~1.24M. Estimates only.
- Agents (order): implementer (steps 1-10) → test-writer → architecture-reviewer ‖ security-reviewer → doc-writer ‖ plan-verifier → pr-self-review (PASS with advisories) → fix round (3 findings + 2 polish). All ran as general-purpose subagents given the role files from .claude/agents, not as registered named agents; no re-review or re-verify after the fix round.
- Difficulties: (1) the cloud/VM shell has no pnpm and macOS-built node_modules, so vitest never ran there; only tsc and dependency-cruiser could be run, and the tests were checked by reading until the user ran them on the Mac; (2) I gave `pnpm typecheck` / `--filter` commands that do not exist at the repo root (no root package.json); (3) running `pnpm typecheck` in mcp/ on the Mac auto-installed and left untracked mcp/pnpm-lock.yaml and mcp/pnpm-workspace.yaml (violates the lock-file rule); (4) test-writer could not add userEvent (not installed) and could not test PullDetailScreen (too coupled); (5) server tsconfig covers src only, so new test files were not typechecked by `pnpm typecheck`; (6) `pnpm test:integration` is referenced in AGENTS but absent from the committed package.json (skip-worktree).
- Easy: detailed plan with per-step skill list; mirroring the blast module and onboarding-generator patterns; dependency-cruiser and tsc ran fine in the VM; domain/normalize logic was pure and easy to smoke test without vitest.
- Duplicated: every agent re-read plan, AGENTS.md files, INSIGHTS and skill SKILL.md files; the same findings (OverviewTab boundary, stray mcp files, cross-module imports, missing redaction) were re-reported by four agents; known findings had to be pasted into later prompts by hand.
- Missed: the OverviewTab.risks-outside-boundary bug and the unredacted documents/intent and unwrapped file paths were found only at review time, not by implementer self-check; plan-verifier ran before the fix round so its PLAN_INCOMPLETE report is stale; no test for PullDetailScreen setParams/severity flow; observability NFR (provider/model in logs) only partly covered; tests never executed before the reviewers' verdict.
- Recommendations (proposed, not applied):
  1. Put a "how to run checks" note in implement-plan / implementer: run tsc + dependency-cruiser in the VM, run vitest on the user's Mac, and ask for results before the review phase (benefit: verdict based on executed tests).
  2. Order the chain verifiers after fixes: implementer → test-writer → reviewers → fix round → plan-verifier → pr-self-review, so the final verdict reflects the final code.
  3. Add to implementer's self-check: untrusted-wrapping and redaction checklist for any new prompt builder, and "every prop read inside an error boundary" rule (benefit: catches the two medium findings earlier).
  4. Add a root-level note (or root package.json scripts) listing per-package commands, and warn that `pnpm` in a package without node_modules auto-installs and creates lock files.
  5. Have implement-plan pass a shared "known findings" file between agents instead of pasting them into prompts, and let agents skip re-reading unchanged context.
  6. Add `server/test` to a tsconfig used by `pnpm typecheck` (or a `typecheck:tests` script) so new tests are typechecked.
