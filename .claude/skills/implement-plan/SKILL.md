---
name: implement-plan
description: Runs the post-planning Spec-Driven Development execution loop — implementer, then architecture-reviewer (and optionally security-reviewer), iterating fixes until clean or a cap is hit, then plan-verifier, then pr-self-review for the merge verdict. Takes an existing Implementation Plan as input; never creates a spec or a plan itself.
metadata:
  version: "1.0.0"
  scope: "Orchestrates implementer/architecture-reviewer/security-reviewer/plan-verifier/pr-self-review for one Implementation Plan"
---

# Implement Plan (SDD execution)

Use this skill once a spec (`spec-creator`) and an Implementation Plan (`implementation-planner`,
saved under `docs/plans/`) already exist. **This skill does not create a spec or a plan.** Give it
a plan, and it drives execution from implementation through to a merge-ready verdict.

`spec-creator` and `implementation-planner` are run manually, before invoking this skill, on
purpose — keep those steps separate so the spec and the plan get a human look before any
implementation tokens are spent.

## Inputs

- **`plan`** (required): a path under `docs/plans/**`, or the plan content pasted inline.
- **`requirements`** (optional): extra free-text requirements/clarifications not already captured
  in the plan. Passed to `implementer` as additional context — never as a plan replacement; if it
  contradicts the plan, that's a conflict to report, not silently resolve.
- **`designs`** (optional): design references (Figma links, screenshots, pasted copy). Passed to
  `implementer` and to the review agents as context only. This skill does not re-derive acceptance
  criteria from them — that's `spec-creator`'s job, run separately if the designs reveal a gap.
- **`skip_security`** (optional flag, default: `false`): skip the `security-reviewer` pass. Leave
  this on unless the change has no auth/input-validation/`reviewer-core` surface — see "Cost notes".
- **`max_fix_iterations`** (optional, default: `2`): cap on architecture-review-fix loops before
  escalating to the user instead of looping forever.

## Workflow

1. **Implement.** Spawn `implementer` with the plan. Append `requirements`/`designs`, if given, as
   clearly labeled extra context ("not part of the plan — additional context"), not as new plan
   steps. Capture the Implementation Report and the git range touched.
2. **Review.** Spawn `architecture-reviewer` on that git range. Unless `skip_security` is set,
   spawn `security-reviewer` on the same range **in the same message** — one Agent call each,
   launched together, not sequentially (see `.claude/agents/README.md#Pipeline`: the two are
   independent and neither's findings depend on the other).
   - `test-writer` is intentionally **not** run by this skill (cost-saving default, per explicit
     request). Say so in the final report so a reader doesn't mistake this for "tests exist."
3. **Fix loop (architecture-reviewer only).** If `architecture-reviewer` returned any finding with
   `blocking_candidate: yes`, or `severity: high`/`critical`: spawn `implementer` again, passing
   only those specific findings (`id`, `file:line`, `rule_source`, `remediation_direction`) as what
   to fix — not the whole plan again. Re-run `architecture-reviewer` on the updated range.
   - Repeat up to `max_fix_iterations` times.
   - If findings of that severity remain after the cap, stop looping. Report it as open
     architecture debt blocking the plan rather than retrying indefinitely or quietly dropping it.
   - `security-reviewer` findings are **not** auto-fix-looped here — list them in the final report
     and let the user decide; security trade-offs usually need a human call. Re-run
     `security-reviewer` only if the user explicitly asks for a fix pass.
4. **Verify.** Once the architecture fix loop is clean (or capped out), spawn `plan-verifier`
   against the plan and the final git range.
5. **Merge gate.** Run the `pr-self-review` skill (not an agent) to merge architecture, security,
   and plan-traceability findings into one `PASS`/`BLOCKED`/`REVIEW_FAILED`/`PARTIAL` verdict. This
   is the only step in this flow that issues a merge status.
6. **Report.** Summarize: what was implemented; what was fixed and in how many iterations; any
   architecture/security findings still open; `plan-verifier` status; the final `pr-self-review`
   verdict; and an explicit line that `test-writer` was skipped — recommend running it before
   merge if the plan's "Testing strategy" section called for new tests.

## Cost notes

- `implementer`, `architecture-reviewer`, and `plan-verifier` already pin `model: sonnet` in their
  own frontmatter (`.claude/agents/*.md`) — there is nothing to "move to Sonnet," none of them run
  on Opus regardless of the orchestrating session's model.
- The actual cost levers this skill exposes are: (a) skipping `test-writer` by default, (b) capping
  the architecture fix loop via `max_fix_iterations` instead of looping until perfectly clean, (c)
  `skip_security` for changes with genuinely no security surface — prefer leaving it on for
  anything touching auth, input validation, or `reviewer-core`.

## Explicitly out of scope

- Writing or editing a spec — `spec-creator`, run manually before this skill.
- Writing or editing an Implementation Plan — `implementation-planner`, run manually before this
  skill.
- Writing tests — `test-writer` is skipped by default; run it separately before merge.
- Any merge verdict beyond what `pr-self-review` returns in step 5.
