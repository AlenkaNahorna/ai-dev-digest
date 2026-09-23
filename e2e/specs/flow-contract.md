# E2E flow contract

Flow files are ordered command lists. `{BASE}` is replaced with the configured
web origin. Assertions are command exit codes or explicit stdout substring
checks. PR detail flows rely on the seeded `acme/payments-api` repository and
PR #482; they must remain deterministic and must not use the AI `chat` command.
The findings flow opens the Agent runs tab, verifies the seeded review-run
summary, expands the run, and checks a rendered finding card. List-page flows
may verify read-only findings previews, but must never assert Accept/Dismiss
controls there: those actions belong only to the expanded detail review card.
