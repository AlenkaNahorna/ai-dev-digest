# Reviewer-core architecture

Reviewer-core is a pure TypeScript pipeline. It assembles a prompt from the
diff and injected context, calls an injected `LLMProvider`, parses structured
output, then applies mechanical grounding before returning a review. It has no
database, filesystem, GitHub, or secret access.

The server supplies production adapters through dependency injection; tests use
deterministic mock providers. The pipeline is split into prompt assembly,
structured provider output, multi-chunk reduction, and mechanical citation
grounding. Only grounded findings reach the returned review, and
`scoreFromFindings` derives the score from that same surviving list so the
verdict, score, and UI finding count remain consistent.

The module exports contracts and pure helpers for the server and CI runner.
Persistence, GitHub comments, trace storage, and credentials remain outside
this package and are supplied by callers.
