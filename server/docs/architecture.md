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
