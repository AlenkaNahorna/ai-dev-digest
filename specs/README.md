# Cross-module specs

This folder holds **feature specs that affect two or more modules** (e.g. a change to a
contract shared by `server` + `client`, or any behavior change that crosses a module
boundary).

- A feature spec touching exactly one module belongs in that module's own folder:
  `server/specs/`, `client/specs/`, `reviewer-core/specs/`, `e2e/specs/`, `mcp/specs/`.
- A feature spec touching 2+ modules belongs here, at `specs/SPEC-<YYYY-MM-DD>-<slug>.md`.
- Long-lived architecture specs (module boundaries, contracts, data flow, stack, invariants)
  are **not** here — they live in `docs/architecture.md` (root) or `<module>/docs/architecture.md`.
  This folder is for one-behavior-change feature specs only.

A spec's ID is `SPEC-<YYYY-MM-DD>-<slug>`: the feature name in kebab-case plus the date the spec
was created (e.g. `SPEC-2026-10-11-onboarding-generator`). The file name is the ID plus `.md`.
There is no sequence number, so IDs never collide across folders, and an ID never changes after
creation. The two earlier numeric IDs were migrated to this form (`SPEC-01` → `SPEC-2026-10-11-project-context`,
`SPEC-02` → `SPEC-2026-10-11-onboarding-generator`).

Specs here are authored by the `spec-creator` agent (see
[`.claude/agents/spec-creator.md`](../.claude/agents/spec-creator.md)); `implementation-planner`
reads them as input and never edits them. A spec's `Status` field
(`draft → approved → implemented`) is changed by a human, not by the agent.
