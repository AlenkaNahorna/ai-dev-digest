# Server architecture

Fastify registers module plugins over a dependency-injected container. Routes
validate params and bodies with shared Zod contracts, then call repositories or
adapters. Drizzle persists PostgreSQL state; LLM, GitHub, git, secrets, and
indexing integrations are injected so unit tests can replace them with mocks.

The pull-list route enriches imported GitHub pull requests with review score,
cost, and findings counts. Review rows are read newest-first: the score comes
from the newest review overall, while the FINDINGS rollup selects only the
newest review for each agent before grouping persisted findings by severity.
Costs are aggregated independently from successful agent runs, so a PR with no
runs remains `null` rather than becoming `$0.00`. The endpoint performs SQL
aggregation over stored rows; it does not invoke reviewer-core or an LLM while
rendering a page.

The detail endpoints keep a different purpose: `/pulls/:id/runs` exposes the
full timeline, and `/pulls/:id/reviews` exposes every persisted review with its
findings. This lets the list show current per-agent status without discarding
historical trace data.

## Project Context (repository documents as run grounding)

The `project-context` module (`src/modules/project-context/`, onion layout like
`blast`) discovers `.md` files in the synced default-branch clone and lets users
attach them, by path and order only, to an agent and to a skill (per repository,
tables `agent_context_docs` / `skill_context_docs`). Documents are view-only in
the product: the clone is a mirror refreshed from the remote, so there is no
write endpoint. Discovery matches configured folder names
(`PROJECT_CONTEXT_ROOTS`, default `specs,docs,insights`) at any depth, skips
`node_modules`, `.git`, `.pnpm-store`, `dist`, `vendor`, `build`, `coverage`,
`.next`, `out` and every symlink, and reads text only through
`GitClient.readFile` (path containment). Tokens use the shared cl100k tokenizer.

The run-executor now reads repository documents at run time. At the start of
each agent's run it calls `container.projectContext.resolveForRun(...)` (the
module's facade on the composition root, not a deep import) once, so a run sees
one snapshot. The effective set is the agent's own documents in agent order,
then the documents of each enabled linked, enabled skill, first occurrence of
each path wins. Unreadable, empty, non-UTF-8 or out-of-root documents are
skipped with a path-only warning in the run log. The text is passed to
`reviewPullRequest({ specs })` and rendered by reviewer-core's
`renderSpecsBlock` as untrusted-delimited items under `## Project context`;
there is no extra LLM call. The trace records `specs_read` (paths in prompt
order), `specs_detail` (tokens per document) and `specs_block_tokens`, and the
exact block is kept in `prompt_assembly.specs`, including for failed and
cancelled runs (the resolved context is hoisted outside the `try`).
Attaching or detaching documents does not create an agent or skill version.
Map-reduce re-assembles the prompt per chunk, so the project-context tokens are
multiplied by the number of chunks; the UI only warns above
`PROJECT_CONTEXT_WARN_TOKENS` (default 100000), it never truncates.
