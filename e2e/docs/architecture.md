# E2E architecture

The E2E package runs JSON flow specs through a thin Vitest runner and the
deterministic `agent-browser` CLI. The browser talks to a seeded local stack;
flows do not call an LLM and use URL, text, and accessible-role locators only.
Hermetic execution starts isolated Postgres/API/web processes and tears them
down after the flow suite.
