---
name: workflow-retro
description: Manual-only retrospective after a multi-agent workflow run (spec → plan → implement → review). Collects metrics, difficulties, duplicated work, gaps, and proposes improvements. Never auto-triggered.
disable-model-invocation: true
---

# Workflow Retro

Run **only when the user invokes it manually** (e.g. `/workflow-retro` or `/workflow-retro deep`). Never start it from `implement-plan`, hooks, schedules or any other skill. Never auto-run implement-plan from here.

## Modes
- `in-context` (default): use only what is visible in the current conversation. State clearly that numbers are estimates when the session does not expose exact values.
- `deep`: additionally read the session transcript / git log / `docs/plans/*` and `specs/*` to verify claims. Say which sources were read.

## What to collect
1. **Scope**: feature/spec, plan file, branch, date.
2. **Tokens per session**: total, cache-read, and per agent/phase if known; mark "unknown" rather
   than guessing. Cache-read tokens matter separately from total tokens — a phase can be
   token-heavy but cheap (high cache-read share) or token-light but expensive (low cache-read,
   mostly fresh input); call out which phases of the run look like which.
3. **Agents**: number of agents and the order they ran (implementer → reviewers → plan-verifier → test-writer → pr-self-review), which ran in parallel, and the tool-call count per agent/phase if known (mark "unknown" rather than guessing) — a high tool-call count relative to output is itself a signal worth flagging under "Difficulties" or "Duplicated information".
4. **Difficulties**: blockers, retries, wrong guesses, tool/permission issues, ambiguity in the spec.
5. **What was easy**: steps that went smoothly and why (clear ACs, existing patterns to mirror, etc.).
6. **Duplicated information**: facts re-read, re-derived or restated across agents/phases.
7. **What was missed**: requirements, ACs, tests, docs, or checks skipped or found late.

## Recommendations (required)
End with concrete proposals: changes to specs/agents/skills/process, each with rationale and expected benefit. Proposals are **"proposed, not applied"** — never edit specs, agents or skills from this skill.

## Output
1. Print the retro in the chat (concise, sections as above).
2. Append one entry to `docs/retro/ledger.md` (create the file if absent). Module-level insights go there too. Entry format:

```
## <YYYY-MM-DD> — <feature/spec id> (<mode>)
- Branch / plan: ...
- Tokens (total / cache-read): ...
- Agents (order, tool calls each): ...
- Difficulties: ...
- Easy: ...
- Duplicated: ...
- Missed: ...
- Recommendations (proposed, not applied): ...
```

Never overwrite earlier entries. Do not include secrets or raw prompt text.
