# E2E architecture

The E2E package runs JSON flow specs through a thin Vitest runner and the
deterministic `agent-browser` CLI. The browser talks to a seeded local stack;
flows do not call an LLM and use URL, text, and accessible-role locators only.
Hermetic execution starts isolated Postgres/API/web processes and tears them
down after the flow suite. The workflow uses the seeded fixtures, with the API
on `3001` and the production Next.js server on the CI E2E port `3000`; local
development may use the client dev port `3005`.

The runner checks user-visible behavior rather than internal React state: URL
waits prove navigation, text waits prove rendered data, and role/label locators
cover controls. This keeps flows useful across refactors while still detecting
broken API wiring, review-run expansion, and findings popovers.
