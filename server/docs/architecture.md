# Server architecture

Fastify registers module plugins over a dependency-injected container. Routes
validate params and bodies with shared Zod contracts, then call repositories or
adapters. Drizzle persists PostgreSQL state; LLM, GitHub, git, secrets, and
indexing integrations are injected so unit tests can replace them with mocks.

The pull-list route enriches imported GitHub pull requests with review score,
cost, and latest-review finding counts. It performs SQL aggregation over stored
rows; it does not invoke reviewer-core or an LLM while rendering a page.
