# Reviewer Core Module — @devdigest/reviewer-core

Pure review logic: **diff → prompt → LLM → grounded findings**. No database, GitHub, or filesystem; the only side effect is an **injected** LLM call. This makes it fully mock-testable.

## Stack

- **Language**: TypeScript (source-only; no build output)
- **LLM Integration**: OpenAI SDK (swappable via injected `LLMProvider`)
- **Contracts**: Zod schemas (shared from `../server/src/vendor/shared`)
- **Testing**: Vitest (hermetic; stubbed LLMProvider)

## Architecture

### Review pipeline

```
Inputs (diff, system prompt, repo map)
  ↓
assemblePrompt()
  - Merge diff + system prompt + repo map
  - Optional slots: skills, memory, specs, callers (from course lessons)
  ↓
wrapUntrusted() + INJECTION_GUARD
  - Fence untrusted content (repo map) vs. prompt injection
  ↓
LLMProvider.complete()
  - Call LLM (OpenAI, Anthropic, OpenRouter)
  ↓
structured output (Zod → JSON Schema)
  - Parse & validate model response with repair
  ↓
groundFindings()
  - Mechanical citation gate: every finding must cite a real line in the diff
  - Drops hallucinated locations
  ↓
Review (verdict, score, grounded findings)
```

The **grounding step is mandatory**: a finding that doesn't cite a diff line is dropped, so hallucination is mechanically prevented.

### Public API (src/index.ts)

**Prompt assembly**:
- `assemblePrompt(diff, systemPrompt, repoMap, slots?)` — Build the full prompt
- `wrapUntrusted(content)` — Escape untrusted content (repo map) to prevent injection

**Grounding & output**:
- `groundFindings(findings, diff)` — Apply grounding gate; return only valid findings
- `groundingSummary(findings)` — Summarize grounding results
- `extractJson(text)` — Extract JSON from model response
- `parseWithRepair(text, schema)` — Parse with fallback repair

**Entrypoint**:
- `run(inputs)` — Single-pass review orchestration
- `reduce()` — Map-reduce path (for L07 multi-agent, but defined here)

**Contracts** (from `@devdigest/shared`):
- `Review` — Verdict, score, findings
- `Finding` — Code location, title, description, severity
- `Verdict` — safe | risky | recommend_change

## Key Files

- `src/review/prompt.ts` — Prompt assembly, slot expansion
- `src/review/grounding.ts` — Citation validation, hallucination gate
- `src/llm/openrouter.ts` — LLM adapter (abstracted behind `LLMProvider`)
- `src/llm/structured.ts` — JSON Schema generation, repair parsing
- `src/review/run.ts` — Main orchestration
- `src/index.ts` — Public API exports

## Testing

```bash
pnpm test       # Vitest (hermetic; stubbed LLMProvider)
pnpm typecheck  # TypeScript validation (also acts as build)
```

All tests use a **MockLLMProvider**: inject test responses without hitting any LLM. Coverage includes:
- Prompt assembly correctness
- Grounding gate (hallucination blocking)
- `toReview()` selection (score, verdict)
- Full `run()` integration with mock LLM

## Integration

### In the server

Server (`../server`) consumes via tsconfig path alias:
- `@devdigest/reviewer-core` → `../reviewer-core/src`
- Runs reviews in `src/modules/reviews/` routes
- Passes: diff, system prompt, repo map, selected agent
- Injects: prod `LLMProvider` (OpenAI/Anthropic/OpenRouter)

### In CI (L06)

Export-to-CI lesson (L06) runs the same engine in GitHub Actions via agent-runner.

### Course lesson slots

Extra optional prompt slots (omitted in starter; filled in later lessons):
- `skills` (L02) — Skill descriptions to inject
- `memory` (L07) — Per-agent persistent context
- `specs` (L05) — Project spec/requirements
- `callers` (multi-agent) — Function caller context

`assemblePrompt()` skips sections for omitted slots, so backwards-compatible.

## Key Rules

- **Immutable inputs**: `diff`, `systemPrompt`, `repoMap` are read-only
- **Grounding is mandatory**: No exceptions; every finding must cite a diff line
- **Score is recomputed**: Not trusted from the model; deterministically recalculated from surviving findings
- **No secrets**: LLMProvider is injected; the engine never reads API keys
- **Deterministic tests**: No LLM calls; all test responses are stubbed

## Related Documentation

- [Review pipeline diagram](README.md#pipeline) — Full flow
- [Public API](README.md#public-api) — Exports & contracts
- [Server integration](../server/CLAUDE.md) — How server runs reviews
- [Testing strategy](../TESTING.md) — Unit tests, no LLM needed
- [Root CLAUDE.md](../CLAUDE.md) — Project structure

## Session Protocol — Reviewer Core Module

### 🟢 BEFORE You Start

**Read reviewer-core/ENGINEERING-INSIGHTS.md** and summarize the top 3 entries relevant to your task:
- Working on grounding? → Check "What Works" (mechanical citation gate)
- Working on prompt assembly? → Check "What Doesn't Work" (injection risks, token limits)
- Working on LLM integration? → Check "Codebase Patterns" (LLMProvider injection)
- Writing tests? → Check "Tool & Library Notes" (MockLLMProvider)

**Example**: "I'm improving grounding to handle line ranges. Top 3 relevant insights:
1. Grounding gate is mechanical and deterministic; no exceptions
2. Every finding must cite a real line in the diff or it's dropped
3. Score recalculation: don't trust model's score; recalc from surviving findings"

### 🔴 END OF SESSION

Write insights **only if substantial**. Check ENGINEERING-INSIGHTS.md first for duplicates.

**Common scenarios:**

✅ **Write**: "Grounding gate catches hallucinated line numbers; mechanical check defeats LLM tricks"
❌ **Skip**: "Hallucinations are bad" (obvious)

✅ **Write**: "parseWithRepair() handles invalid JSON from model; fallback parser recovers partial data"
❌ **Skip**: "Use Zod" (already in stack)

## Lazy-Load Context

- **Skills**: `/security` (for security findings), `/engineering-insights`
- **Module insights**: See `ENGINEERING-INSIGHTS.md` (append-only learnings from prior sessions)
- **Related modules**: See [server/CLAUDE.md](../server/CLAUDE.md) (consumer), [e2e/CLAUDE.md](../e2e/CLAUDE.md) (integration tests)
