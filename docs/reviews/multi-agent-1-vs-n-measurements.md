# Multi-Agent Review: measured "1 vs N"

Status: **no numbers recorded yet.** Numbers must come from real runs; none are estimated or back-filled here.

## What is measured

The results page (block "1 vs N agents — measured on this PR") computes, on read and without storing anything:

- tokens (in + out) of the N agent runs vs. the latest finished single-agent local run of one of the same agents on the same PR;
- cost (runs with unknown cost are excluded and counted, never treated as $0);
- wall-clock of the multi-agent review (start of the parent run to the end of the last agent) vs. the baseline duration;
- the shared intent call, shown separately (made once per review; not part of per-agent totals).

The ratio is `this review ÷ baseline`. It is **not** compared with any expected N×. Prompt caching, the shared diff
preparation, and different answer lengths can move it either way; report what is measured, including ratios below 1× or above N×.

## Protocol

1. Pick a PR. Run ONE agent on it from the PR page (this becomes the baseline).
2. From `/multi-agent`, run the same agent plus two others (N = 3) on the same PR, same provider/model settings.
3. Open the results page and copy the "1 vs N" table. Open the trace of each agent for tokens, cost and grounding decisions.
4. Repeat for 3+ PRs of different size; note whether the provider cache was warm.

## Results (fill from real runs)

| Date | PR | Agents (N) | Tokens 1 → N | Cost 1 → N | Wall-clock 1 → N | Ratio tokens / cost / time | Cache warm? | Notes |
|------|----|-----------|--------------|------------|------------------|----------------------------|-------------|-------|
|      |    |           |              |            |                  |                            |             |       |

## Interpretation

Write the conclusion only after the table has rows, and state it as observed (e.g. "tokens 2.4×, wall-clock 1.1× on PR #…"),
not as confirmation or refutation of an expected 3×.
