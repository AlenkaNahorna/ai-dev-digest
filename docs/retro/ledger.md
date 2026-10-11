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
