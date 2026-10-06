# Cross-module specs

This folder holds **feature specs that affect two or more modules** (e.g. a change to a
contract shared by `server` + `client`, or any behavior change that crosses a module
boundary).

- A feature spec touching exactly one module belongs in that module's own folder:
  `server/specs/`, `client/specs/`, `reviewer-core/specs/`, `e2e/specs/`, `mcp/specs/`.
- A feature spec touching 2+ modules belongs here, at `specs/SPEC-NN-<slug>.md`.
- Long-lived architecture specs (module boundaries, contracts, data flow, stack, invariants)
  are **not** here — they live in `docs/architecture.md` (root) or `<module>/docs/architecture.md`.
  This folder is for one-behavior-change feature specs only.

`SPEC-NN` numbering is local to this folder — it does not share a sequence with any
`<module>/specs/` folder.

Specs here are authored by the `spec-creator` agent (see
[`.claude/agents/spec-creator.md`](../.claude/agents/spec-creator.md)); `implementation-planner`
reads them as input and never edits them. A spec's `Status` field
(`draft → approved → implemented`) is changed by a human, not by the agent.
