# Reviewer-core insights

- [2026-09-21] **Codebase Patterns**: Grounding is a deterministic post-LLM gate, so UI aggregation can safely count persisted findings without asking the model again. Evidence: `reviewer-core/src/review/grounding.ts:1`.
- [2026-10-11] **Correctness**: `wrapUntrusted` must neutralize the closing delimiter case-insensitively and with whitespace (`</UNTRUSTED >`), not only the exact lowercase tag; `renderSpecsBlock` is exported so the server can persist the exact project-context text even when a run fails before `assemblePrompt`. Evidence: `reviewer-core/src/prompt.ts`.
