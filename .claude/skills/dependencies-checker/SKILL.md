---
name: dependencies-checker
description: Audits every package in this repo (server, client, reviewer-core, e2e, mcp) for dependency size, security vulnerabilities, and the relationships between the packages themselves, then produces one structured markdown report with a Mermaid component diagram and a prioritized, security-first action list. Use this whenever the user asks to check/audit/analyze dependencies, find out what's taking up disk space in node_modules, check for vulnerable or outdated packages, understand how the packages in this repo depend on each other, or wants a "dependency report" / "dependency health check" — even if they just say "are our dependencies okay?" or "what's bloating install time?".
---

# Dependencies Checker

Produces one markdown report that answers three questions a developer actually has about this repo's dependencies: *how big is each package, what's actually dangerous in them, and how do the packages relate to each other.* The report format is fixed — see "Report template" below — so it reads the same way every time this skill runs, regardless of how the data changed.

This repo is **not** a single workspace: `server/`, `client/`, `reviewer-core/`, `e2e/`, and `mcp/` each have their own `package.json` and lockfile (pnpm or npm, mixed). "Dependencies between our own packages" here means architectural coupling (symlinked shared contracts, one package calling another's HTTP API, one package driving another in tests) — not npm workspace links. Don't go looking for a `pnpm-workspace.yaml`; there isn't one.

## Step 1 — Collect the data (don't skip to writing prose)

Everything numeric in the report — sizes, dep counts, vulnerability counts, advisories — comes from the bundled script, not from your own recall or guesses about what's probably in `node_modules`. Run it once for the whole repo:

```bash
.claude/skills/dependencies-checker/scripts/collect-deps-data.sh > /tmp/deps-data.json
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

## Step 3 — Prioritize (security-first)

The user wants a security-first action list, not a general cleanup list. Order recommendations by:

1. **Critical** vulnerabilities first, then **High**, then **Moderate**, then **Low** — across all packages, not grouped by package. A critical in a small package outranks a moderate in a big one.
2. Within the same severity tier, prefer advisories where `fixAvailable` is a simple version bump over ones requiring a major-version jump (`isSemVerMajor: true` or no fix available at all) — the former is a same-day fix, the latter needs planning.
3. After vulnerabilities are listed, size observations are secondary color commentary (e.g. "X is the heaviest package by far mostly because of Y") — don't let them crowd out the security list or rank above any real vulnerability.

Every recommendation must be concrete and actionable: which package, which dependency, current → fixed version, and the exact command (`pnpm --filter`-equivalent is N/A here since there's no workspace — use `cd <package> && pnpm audit fix` / `npm audit fix`, or name the specific package to bump when the fix needs a manual version pin).

## Report template

Write the report to `docs/dependency-reports/<YYYY-MM-DD>-dependency-report.md` (create the `dependency-reports/` folder if it doesn't exist yet). Use today's date. Follow this structure exactly — same section order and headings every run, so reports are diffable over time:

```markdown
# Dependency Report — <YYYY-MM-DD>

## 1. Overview

| Package | Manager | node_modules size | Direct deps | Dev deps | Critical | High | Moderate | Low |
|---|---|---|---|---|---|---|---|---|
| server | pnpm | ... | ... | ... | ... | ... | ... | ... |
| ... (one row per package) |

**Total disk size across all `node_modules`:** <sum, human-readable>
**Total open vulnerabilities:** <sum> (<critical> critical, <high> high, ...)

## 2. Component Dependency Diagram

\`\`\`mermaid
flowchart LR
  ...
\`\`\`

<1-2 sentences max explaining any non-obvious edge — the diagram should mostly speak for itself.>

## 3. Per-Package Breakdown

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

## 4. Prioritized Recommendations

Numbered list, most urgent first, security-first per Step 3. Each item:

`N. [SEVERITY] <package> — <dependency>: <what's wrong>. Fix: <exact command or version bump>. Impact if ignored: <one sentence>.`

## 5. Notes

- Anything the script couldn't check (e.g. audit command failed for a package, registry unreachable) — say so here, don't silently drop it from the report.
- Package manager quirks worth flagging (e.g. a package's `node_modules` shows signs of having been installed by both npm and pnpm at different times).
```

## Gotchas

- **pnpm's flat store.** Top-level `node_modules/@scope/pkg` entries are often 0-byte symlinks under pnpm — the real content lives in `node_modules/.pnpm/pkg@version_hash/`. The script already resolves this; if you ever re-run `du` by hand instead of trusting the script's output, you'll get misleadingly tiny numbers for every pnpm-installed package.
- **A package's installed layout can disagree with its lockfile.** One package in this repo has a `package-lock.json` (so the script runs `npm audit`) but its `node_modules` was actually populated by a stray `pnpm install` at some point, so it also has a `.pnpm` store. The script's size-ranking logic checks for `.pnpm` directly rather than trusting the lockfile, so sizes are still correct — but don't be surprised if you see this mismatch and don't try to "fix" it by deleting `node_modules` as part of this skill; that's out of scope for an audit.
- **`npm audit --json` and `pnpm audit --json` have different JSON shapes** (`vulnerabilities` object vs `advisories` object) — this is why the script branches on package manager rather than using one parser for both. If you ever need to extend the script, check both shapes against real output before assuming one schema.
