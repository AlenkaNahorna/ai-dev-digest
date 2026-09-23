# Reviewer-core insights

- [2026-09-21] **Codebase Patterns**: Grounding is a deterministic post-LLM gate, so UI aggregation can safely count persisted findings without asking the model again. Evidence: `reviewer-core/src/review/grounding.ts:1`.
