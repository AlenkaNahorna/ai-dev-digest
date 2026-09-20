# E2E flow contract

Flow files are ordered command lists. `{BASE}` is replaced with the configured
web origin. Assertions are command exit codes or explicit stdout substring
checks. PR detail flows rely on the seeded `acme/payments-api` repository and
PR #482; they must remain deterministic and must not use the AI `chat` command.
