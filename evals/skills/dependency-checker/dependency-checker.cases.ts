import type { SkillCase } from "../../src/index.js";

// This skill's job is to analyze real files (package.json, lockfiles, node_modules sizes, imports),
// but "quality" cases run with no tools (skillTask measures the SKILL.md content in isolation —
// see tasks.ts). So each prompt inlines a dataset the skill can reason over directly, standing in
// for what the skill would normally gather itself with Read/Bash/Grep.
//
// The dataset below comes from the real repo (ai-dev-digest) on this fork. Numbers in the
// "Collector output" block are the JSON emitted by .claude/skills/dependency-checker/scripts/
// collect-deps-data.sh, which the skill's Step 1 requires; the rest was checked against package.json,
// grep and tsconfig. The audit step returned no usable advisory data in this run, so the report must
// say that instead of claiming zero vulnerabilities.

const REPO_DATA = `Here is the data you'd normally gather yourself — treat it as already collected, and produce the report directly from it (do not ask for tool access or more data).

Packages in scope (5): server, client, reviewer-core, e2e, mcp.
Lockfiles present: server/pnpm-lock.yaml, client/pnpm-lock.yaml, mcp/pnpm-lock.yaml AND mcp/package-lock.json, reviewer-core/package-lock.json, e2e/package-lock.json.

Declared dependencies (package.json, as written):
server dependencies: @anthropic-ai/sdk ^0.33.1, @ast-grep/napi 0.43.0, @fastify/autoload ^6.0.3, @fastify/cors ^10.0.2, @fastify/helmet ^13.0.2, @fastify/rate-limit ^11.0.0, @vscode/ripgrep ^1.15.9, dependency-cruiser ^17.4.3, dotenv ^16.4.7, drizzle-orm ^0.38.3, fastify ^5.2.0, fastify-sse-v2 ^4.2.1, fastify-type-provider-zod ^4.0.2, graphology ^0.26.0, graphology-metrics ^2.4.0, js-tiktoken ^1.0.21, octokit ^4.0.3, openai ^4.77.0, p-queue ^8.0.1, postgres ^3.4.5, simple-git ^3.27.0, zod ^3.24.1
server devDependencies: @testcontainers/postgresql ^10.16.0, @types/node ^22.10.0, drizzle-kit ^0.30.1, pino-pretty ^13.0.0, testcontainers ^10.16.0, tsx ^4.19.2, typescript ^5.7.2, vitest ^2.1.8
client dependencies: @tanstack/react-query ^5.62.8, lucide-react ^0.469.0, mermaid ^11.15.0, next ^15.1.3, next-intl ^3.26.0, react ^19.0.0, react-dom ^19.0.0, react-markdown ^9.0.3, recharts ^2.15.0, remark-gfm ^4.0.0, zod ^3.24.1
client devDependencies: @tailwindcss/postcss ^4.0.0, @testing-library/jest-dom ^6.6.3, @testing-library/react ^16.1.0, @types/node ^22.10.0, @types/react ^19.0.2, @types/react-dom ^19.0.2, @vitejs/plugin-react ^4.3.4, jsdom ^25.0.1, postcss ^8.4.49, tailwindcss ^4.0.0, typescript ^5.7.2, vitest ^2.1.8
reviewer-core dependencies: openai ^4.77.0, zod ^3.24.1
reviewer-core devDependencies: @types/node ^22.10.0, tsx ^4.19.2, typescript ^5.7.2, vitest ^2.1.8
e2e dependencies: (none)
e2e devDependencies: @types/node ^22.10.0, tsx ^4.19.2, typescript ^5.7.2
mcp dependencies: @modelcontextprotocol/sdk ^1.12.0, zod ^3.24.1
mcp devDependencies: @types/node ^22.10.0, js-tiktoken ^1.0.15, tsx ^4.19.2, typescript ^5.7.2, vitest ^2.1.8

Collector output (scripts/collect-deps-data.sh, one object per package; numbers are as emitted):
- server: package_manager pnpm, node_modules_size 234M, direct_deps 22, dev_deps 8. heaviest_subdeps: typescript 23M, js-tiktoken 22M, drizzle-orm 14M, esbuild 9.6M. vulnerability_summary {}, advisories null.
- client: package_manager pnpm, node_modules_size 620M, direct_deps 11, dev_deps 12. heaviest_subdeps: next 153M, @next+swc-darwin-arm64 125M, mermaid 76M, lucide-react 37M, typescript 23M, @img+sharp-libvips-darwin-arm64 16M. vulnerability_summary {}, advisories null.
- reviewer-core: package_manager npm, node_modules_size 157M, direct_deps 2, dev_deps 4. heaviest_subdeps: typescript 23M, @esbuild+darwin-arm64 11M. vulnerability_summary {}, advisories [] (empty; this is NOT a verified zero).
- e2e: package_manager npm, node_modules_size 37M, direct_deps 0, dev_deps 3. heaviest_subdeps: typescript 23M, esbuild 11M. vulnerability_summary {}, advisories [] (empty; NOT a verified zero).
- mcp: package_manager pnpm, node_modules_size 210M, direct_deps 2, dev_deps 5. heaviest_subdeps: typescript 23M, js-tiktoken 22M, @esbuild+darwin-arm64 11M. vulnerability_summary {}, advisories null.
- Note: the collector's header promises a final {"_summary": true} line, but the script does not emit it.
- Note: several heaviest entries are platform-specific binaries (@next+swc-darwin-arm64, @esbuild+darwin-arm64, @img+sharp-libvips-darwin-arm64) installed on a macOS machine.

Import usage (verified with grep in each package's src):
- client: zod is declared in client/package.json but has ZERO references anywhere under client/ (outside node_modules and .next). It appears only in package.json and the lockfile.
- server: @fastify/autoload is declared but has ZERO imports under server/src. server/src/modules/index.ts says modules are registered explicitly "rather than via filesystem autoload".
- server: dependency-cruiser is declared under dependencies and IS imported at runtime (server/src/platform/container.ts, server/src/adapters/depgraph/index.ts) — it is not an unused dependency.
- drizzle-orm is imported in about 40 server files; openai in about 10 server files; postgres in 4 server files.

Cross-package coupling:
- server/src imports @devdigest/reviewer-core and @devdigest/shared by package name or alias. No relative import into another package's internals was found in server/src, client/src or mcp/src.
- reviewer-core/tsconfig.json maps "@devdigest/shared" to "../server/src/vendor/shared/index.ts" (and "../server/src/vendor/shared/*"), i.e. reviewer-core resolves a shared contract directly from the server's source tree.
- server/tsconfig.json and client/tsconfig.json map "@devdigest/shared" to their own "./src/vendor/shared" directory.
- No workspace:* protocol is used by any package.json.

Version drift:
- zod is declared as ^3.24.1 in server, client, reviewer-core and mcp. Installed version is 3.25.76 in all four packages. There is NO zod version drift.
- openai is ^4.77.0 in both server and reviewer-core.
- vitest ^2.1.8, typescript ^5.7.2, @types/node ^22.10.0 and tsx ^4.19.2 are identical across every package that declares them.

Vulnerability data: the audit produced no usable advisory data (see vulnerability_summary above). Do not claim zero vulnerabilities and do not list CVEs; say that the audit data is unavailable.`;

export const cases: SkillCase[] = [
  {
    name: "full report follows the required report template with a Mermaid graph",
    kind: "quality",
    prompt: `Run a dependency check on this repo. I want the full report: graph, sizes, prioritized findings, recommendations.\n\n${REPO_DATA}`,
    grounding: ["```mermaid", "flowchart"],
    practices: [
      "the report has a section named 'Scope' listing all five packages analyzed: server, client, reviewer-core, e2e, and mcp",
      "the report includes a Mermaid diagram (a fenced ```mermaid code block using flowchart) showing dependency relationships between packages",
      "the report's Overview table and Per-Package Breakdown use the collector sizes (e.g. client 620M, next 153M, mermaid 76M), not invented numbers",
      "the report's sections appear in the template's order: Scope, Overview, Component Dependency Diagram, Internal vs External Dependencies, Unused Dependencies, Per-Package Breakdown, Findings & Priorities, Summary, Notes (Version Drift is omitted because there is no drift)",
      "the report has a 'Findings & Priorities' section (or equivalently named) that groups findings under explicit tiers P0, P1, P2 or Info — not an unranked bullet list",
      "the report ends with a Summary section giving 3-5 concrete, actionable takeaways ordered by priority",
      "the report says vulnerability data is unavailable (empty audit output) and does NOT claim zero vulnerabilities or list any CVEs",
      "every finding names a specific package, dependency, or file rather than giving generic advice like 'consider optimizing dependencies'",
    ],
    threshold: 0.7,
    maxTurns: 10,
  },
  {
    name: "distinguishes internal (path-alias) dependencies from external npm dependencies",
    kind: "quality",
    prompt: `This repo isn't a pnpm workspace — packages share code via package names and TypeScript path aliases, not workspace:* links. Analyze our dependencies, including how these packages depend on each other internally.\n\n${REPO_DATA}`,
    practices: [
      "the answer explicitly distinguishes internal cross-package dependencies (@devdigest/reviewer-core, @devdigest/shared) from external npm package dependencies, rather than treating them as the same kind of dependency",
      "the answer flags reviewer-core/tsconfig.json mapping @devdigest/shared to ../server/src/vendor/shared as internal coupling that reaches into another package's source tree",
      "the answer does not treat server's import of @devdigest/reviewer-core as a relative-path bypass, since it goes through the package name",
      "the answer does not claim these packages are linked via workspace:* protocol dependencies",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "severity tiers are used consistently and recommendations are specific, not vague",
    kind: "quality",
    prompt: `We suspect some npm dependencies are unused and that package versions have drifted across packages. Check our dependencies and tell me what to prioritize fixing first.\n\n${REPO_DATA}`,
    practices: [
      "findings are explicitly labeled with one of the defined tiers (P0, P1, P2, or Info) rather than left unranked",
      "calls out client/package.json's zod as an unused dependency with no references under client/",
      "calls out server/package.json's @fastify/autoload as an unused dependency with no imports under server/src",
      "does NOT report zod version drift, since all four packages declare ^3.24.1 and resolve to the same 3.25.76",
      "reports the mixed package managers and lockfiles (pnpm-lock.yaml in server, client and mcp vs package-lock.json in reviewer-core and e2e, plus both lockfiles in mcp) in the Notes section, as the template requires",
      "each recommendation names a specific package name and package.json or file location rather than a generic suggestion",
      "removing a dependency is presented as a recommendation for the user to confirm, not something already executed",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
