/**
 * Port that supplies the ncc-built agent-runner bundle (`dist/index.js`) that is
 * committed to the target repo as `.devdigest/runner/index.js` (AC-3). The
 * concrete adapter reads it from a configured/relative path on disk (R3). If the
 * bundle is missing (runner not built), the adapter throws so the export fails
 * clearly ("export unavailable") rather than committing a repo without a runner.
 */

export interface RunnerBundlePort {
  /** Full text of the bundled runner, or throws if it cannot be located. */
  read(): string;
}
