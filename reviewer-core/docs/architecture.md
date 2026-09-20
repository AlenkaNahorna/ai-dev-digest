# Reviewer-core architecture

Reviewer-core is a pure TypeScript pipeline. It assembles a prompt from the
diff and injected context, calls an injected `LLMProvider`, parses structured
output, then applies mechanical grounding before returning a review. It has no
database, filesystem, GitHub, or secret access.

The server supplies production adapters through dependency injection; tests use
deterministic mock providers.
