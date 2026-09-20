# Server insights

- [2026-09-21] **Codebase Patterns**: PR-list finding badges must aggregate the newest persisted review with SQL counts; page rendering must not invoke reviewer-core or an LLM. Evidence: `server/src/modules/pulls/routes.ts:151`.
- [2026-09-21] **Clarification**: The PR list findings column aggregates all persisted review runs, while the score remains from the newest run; otherwise a clean newest run hides findings from an older run still visible on the detail page. Evidence: `server/src/modules/pulls/routes.ts:157`.
- [2026-09-21] **Recurring Errors & Fixes**: Keep enriched list-only fields nullish in both vendored shared contracts because raw GitHub pull-request fixtures do not provide them. Evidence: `server/src/vendor/shared/contracts/platform.ts:176`.
