import type { CiRun } from "@devdigest/shared";

/**
 * A CI Runs list row. The shared `CiRun` carries `repo` (the installation's
 * repository, AC-19), `verdict`, severity counts, `commit_sha`/`run_id`/
 * `run_attempt`, `agent` (agent name) and `duration_s`, so the row is just
 * `CiRun`.
 */
export type CiRunRow = CiRun;
