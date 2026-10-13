---
name: dependency-checker
description: Audits every package in this repo (server, client, reviewer-core, e2e, mcp) for dependency size, security vulnerabilities, internal-vs-external coupling, version drift, and unused dependencies, then produces one structured markdown report with a Mermaid component diagram, a Scope section, and a P0/P1/P2/Info-tiered findings list ending in a short Summary. Use this whenever the user asks to check/audit/analyze dependencies, find out what's taking up disk space in node_modules, check for vulnerable or outdated packages, understand how the packages in this repo depend on each other, or wants a "dependency report" / "dependency health check" — even if they just say "are our dependencies okay?" or "what's bloating install time?".
---

# Dependency Checker

Produces one markdown report that answers four questions a developer actually has about this repo's dependencies: *what's in scope, how big is each package, what's actually dangerous or wrong (including coupling and drift, not just CVEs), and what should I do first.* The report format is fixed — see "Report template" below — so it reads the same way every time this skill runs, and so the same section names and severity vocabulary (`P0`/`P1`/`P2`/`Info`) show up every time, regardless of how the underlying data changed.

This repo is **not** a single workspace: `server/`, `client/`, `reviewer-core/`, `e2e/`, and `mcp/` each have their own `package.json` and lockfile (pnpm or npm, mixed). "Dependencies between our own packages" here means architectural coupling (symlinked shared contracts, one package calling another's HTTP API, a tsconfig path alias, one package driving another in tests) — not npm workspace links. Don't go looking for a `pnpm-workspace.yaml`; there isn't one.

**You don't always have tool access when this skill is invoked.** Sometimes you'll be handed already-collected data directly in the conversation (file contents, `du` output, grep results pasted inline) instead of being able to run the script yourself. In that case, skip straight to analyzing the given data — don't ask for tool access or claim you can't produce a report without running commands yourself. The method below (Steps 1–4) is the same either way; only *how* the raw facts reach you differs.

## Step 1 — Collect the data (don't skip to writing prose)

Everything numeric in the report — sizes, dep counts, vulnerability counts, advisories — comes from the bundled script, not from your own recall or guesses about what's probably in `node_modules`. Run it once for the whole repo:

```bash
.claude/skills/dependency-checker/scripts/collect-deps-data.sh > /tmp/deps-data.json
```

This takes ~15 seconds (it runs `pnpm audit` / `npm audit` per package, which hits the registry). It emits one JSON object per package — `server`, `client`, `reviewer-core`, `e2e`, `mcp` — each with:

- `package_manager`: which lockfile/install layout was detected (`pnpm` or `npm`) — this is informational, not something you need to act on.
- `node_modules_size`: human-readable total disk size.
- `direct_deps` / `dev_deps`: counts straight from `package.json`.
- `heaviest_subdeps`: top 10 heaviest installed packages by disk size (pnpm's flat `.pnpm` store is resolved correctly, so this is the real installed size, not a 0-byte symlink).
- `vulnerability_summary`: counts by severity (`critical`/`high`/`moderate`/`low`/`info`).
- `advisories`: the actual list — module name, severity, title/description, vulnerable range, and the fix (patched version or `fixAvailable`).

Read the file with `jq` or the Read tool — don't try to eyeball raw `du` output yourself, the script already did the hard part (expanding pnpm's `.pnpm` store, deduping scoped packages, running the right audit command per package manager).

If a package shows `"error"` instead of data (missing `package.json`), say so in the report instead of silently omitting it.

## Step 2 — Build the component diagram

This part isn't mechanical — it requires knowing how the packages actually relate, which the script can't see. Ground it in what you can verify, not assumption:

1. Read the root `README.md` architecture section and each package's own `README.md`/`AGENTS.md` for stated relationships.
2. Verify the two concrete structural links that are easy to get wrong:
   - `client/src/vendor/shared` is a symlink to `server/src/vendor/shared` (`@devdigest/shared` — the Zod contracts). Confirm with `ls -la client/src/vendor/shared`.
   - `mcp/` talks to `server/` over its REST API (not a direct import) — check `mcp/AGENTS.md` / `mcp/specs/tools-contract.md` for which routes it calls.
3. `e2e/` drives both `client/` (browser) and indirectly `server/` (via the running app) — it's a consumer, not a dependency of either.
4. `reviewer-core/` is imported by `server/` via a tsconfig path alias (not an npm dependency) — check `server/tsconfig.json` / README for the alias name.

Draw this as a Mermaid `graph LR` or `flowchart LR` with solid arrows for real import/symlink relationships and dashed arrows for runtime-only calls (HTTP, driving a browser). Label each edge with *what* the relationship is (e.g. `-->|REST API| `, `-.->|symlink: @devdigest/shared|`), not just an unlabeled line — a developer should understand the coupling from the diagram alone, without reading the prose above it.

## Step 3 — Internal coupling, version drift, unused deps

These three checks matter as much as CVEs and are easy to skip if you only think of "dependencies" as npm packages. Do all three even when you only have inline data to work with (no tool access) — the same reasoning applies, you're just reading the given facts instead of running the grep yourself.

**3a. Internal vs external — call out BOTH, and call them different things.** A dependency between two of *our own* packages (a path alias, a symlink, a relative import reaching into another package's `src/`) is architectural coupling — fixed by code review, not `pnpm audit`. A dependency on an *external* npm package is a supply-chain concern — fixed by version bumps. Never describe both using the same language (don't say `reviewer-core` is "a dependency of" `server` in the same sentence you'd use for "`zod` is a dependency of `server`" — one is internal, one is external, and the report must make that distinction explicit, in its own subsection).

Within internal coupling, specifically flag any import that reaches into another package by a **relative path into its internals** (e.g. `"reviewer-core/src/pipeline.js"` or `"../../reviewer-core/src/something.js"`) instead of going through that package's declared public entry point or alias. This bypasses whatever API boundary the other package intended and breaks the moment its internal file layout changes — treat it as a **P0** every time you see it, regardless of how small or "obviously fine" it looks.

**3b. Version drift.** If the same npm package name appears in more than one of our package.json files with a *different* resolved version (e.g. `zod@3.23.8` in `server`, `zod@3.22.4` in `client`), call it out by name — don't bury it in a generic "keep versions in sync" comment. This causes real bugs: two packages that exchange data (e.g. through `@devdigest/shared`) can silently disagree about a schema's shape if the library version differs.

**3c. Unused dependencies.** For every dependency declared in a `package.json`, check whether anything under that package's `src/` actually imports it (grep for the package name as an import specifier). A dependency that's declared but never imported is dead weight — every byte of its `node_modules` footprint and every CVE it carries is pure downside with zero upside. Name it specifically (package + which `package.json`).

## Step 4 — Prioritize into P0 / P1 / P2 / Info tiers

Every finding in the report — security, internal-coupling, drift, or unused — gets filed into exactly one of these four tiers, and the tier label must appear verbatim in the report (`P0`, `P1`, `P2`, or `Info`; not "critical"/"high"/paraphrases of them):

| Tier | What goes here |
|---|---|
| **P0** | Critical-severity CVEs, and any internal import that bypasses another package's public entry point (see 3a) — regardless of CVE severity, a broken API boundary between our own packages is a P0. |
| **P1** | High-severity CVEs, and version drift (3b) on a package whose shape is shared across packages (e.g. `zod` schemas, anything feeding `@devdigest/shared`). |
| **P2** | Moderate-severity CVEs, version drift on packages that aren't shape-sensitive, and unused dependencies that carry no known vulnerability. |
| **Info** | Low-severity CVEs, and size/heaviest-dependency observations — context, not action items. |

Within a tier, order by: (1) ease of fix — prefer a `fixAvailable`/simple version bump over a major-version jump or a manual code change, (2) blast radius — a finding in a package many others depend on outranks one in an isolated package. Size commentary always lands in `Info` and never outranks a real P0–P2 finding.

Every finding must be concrete and actionable: which package, which dependency or file, current → fixed version (or the specific fix action for non-CVE findings), and the exact command where one exists (`cd <package> && pnpm audit fix` / `npm audit fix` — there's no `pnpm --filter`, this repo isn't a workspace). For an unused dependency or a bypassed-entry-point import, the "fix" is a recommendation to the user to confirm and remove/refactor — never phrase it as something you already did.

## Report template

Write the report to `docs/dependency-reports/<YYYY-MM-DD>-dependency-report.md` (create the `dependency-reports/` folder if it doesn't exist yet). Use today's date. Follow this structure exactly — same section order, same headings, same `P0`/`P1`/`P2`/`Info` vocabulary every run, so reports are diffable over time:

```markdown
# Dependency Report — <YYYY-MM-DD>

## Scope

Packages analyzed: `server`, `client`, `reviewer-core`, `e2e`, `mcp` (list only the ones actually analyzed this run, and say so if any were skipped and why).

## Overview

| Package | Manager | node_modules size | Direct deps | Dev deps | Critical | High | Moderate | Low |
|---|---|---|---|---|---|---|---|---|
| server | pnpm | ... | ... | ... | ... | ... | ... | ... |
| ... (one row per package) |

**Total disk size across all `node_modules`:** <sum, human-readable>
**Total open vulnerabilities:** <sum> (<critical> critical, <high> high, ...)

## Component Dependency Diagram

\`\`\`mermaid
flowchart LR
  ...
\`\`\`

<1-2 sentences max explaining any non-obvious edge — the diagram should mostly speak for itself.>

## Internal vs External Dependencies

**Internal (our own packages):** table or list of path-alias/symlink/relative-import couplings, each labeled with what kind of link it is. Call out any relative import that bypasses a public entry point.

**External (npm):** anything worth flagging here is covered by Version Drift / Unused Dependencies below, or in Per-Package Breakdown — don't duplicate the whole dependency list, just note anything structurally notable (e.g. "all five packages independently depend on `typescript`/`zod` — expected, not a finding").

## Version Drift

Table: package name, versions found, which of our packages declare each version. Omit this section entirely if there's no drift — don't write "no drift found" as an empty table.

## Unused Dependencies

Table: package, declared in which package.json, evidence it's unused (e.g. "grep for 'moment' under server/src found 0 matches"). Omit this section entirely if none are found.

## Per-Package Breakdown

### server (`@devdigest/api`)

**Top heaviest dependencies:**
| Package | Size |
|---|---|
| ... |

**Vulnerabilities:** (omit this subsection entirely if there are none — don't write "no vulnerabilities found" as a table with zero rows)
| Package | Severity | Issue | Vulnerable range | Fix |
|---|---|---|---|---|
| ... |

<repeat this ### subsection for client, reviewer-core, e2e, mcp>

## Findings & Priorities

Numbered list, `P0` first, then `P1`, `P2`, `Info` — within a tier, ordered per Step 4. Each item:

`N. [P0|P1|P2|Info] <package> — <dependency or file>: <what's wrong>. Fix: <exact command, version bump, or recommended refactor>. Impact if ignored: <one sentence>.`

## Summary

3–5 bullets, ordered by priority, each one concrete sentence — the "if you read nothing else, do these" list. Don't repeat the full Findings & Priorities list; distill it.

## Notes

- Anything you couldn't check (e.g. audit command failed for a package, registry unreachable, no tool access so this run is based on supplied data only) — say so here, don't silently drop it from the report.
- Package manager quirks worth flagging (e.g. a package's `node_modules` shows signs of having been installed by both npm and pnpm at different times).
```

## Gotchas

- **pnpm's flat store.** Top-level `node_modules/@scope/pkg` entries are often 0-byte symlinks under pnpm — the real content lives in `node_modules/.pnpm/pkg@version_hash/`. The script already resolves this; if you ever re-run `du` by hand instead of trusting the script's output, you'll get misleadingly tiny numbers for every pnpm-installed package.
- **A package's installed layout can disagree with its lockfile.** One package in this repo has a `package-lock.json` (so the script runs `npm audit`) but its `node_modules` was actually populated by a stray `pnpm install` at some point, so it also has a `.pnpm` store. The script's size-ranking logic checks for `.pnpm` directly rather than trusting the lockfile, so sizes are still correct — but don't be surprised if you see this mismatch and don't try to "fix" it by deleting `node_modules` as part of this skill; that's out of scope for an audit.
- **`npm audit --json` and `pnpm audit --json` have different JSON shapes** (`vulnerabilities` object vs `advisories` object) — this is why the script branches on package manager rather than using one parser for both. If you ever need to extend the script, check both shapes against real output before assuming one schema.
