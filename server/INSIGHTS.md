# Server insights

- [2026-09-21] **Codebase Patterns**: PR-list finding badges must aggregate the newest persisted review with SQL counts; page rendering must not invoke reviewer-core or an LLM. Evidence: `server/src/modules/pulls/routes.ts:151`.
- [2026-09-23] **Correctness**: The PR-list FINDINGS column must count only the newest persisted review for each agent; counting every historical run double-counts an agent after reruns, while the detail page remains the full run history. Evidence: `server/src/modules/pulls/routes.ts:125`.
- [2026-09-21] **Recurring Errors & Fixes**: Keep enriched list-only fields nullish in both vendored shared contracts because raw GitHub pull-request fixtures do not provide them. Evidence: `server/src/vendor/shared/contracts/platform.ts:176`.
