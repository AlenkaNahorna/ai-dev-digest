import type { CiExport, CiInstallation } from "@devdigest/shared";

/**
 * The export response. The one-time plaintext ingest token (`ingest_token`,
 * AC-7/AC-8) and the enriched installation fields now live on the canonical
 * shared contracts (`server/src/vendor/shared/contracts/eval-ci.ts`), so these
 * are plain aliases of the shared types.
 */
export type CiExportResult = CiExport;

/** An installation row for the CI tab (shared contract carries `latest_*`). */
export type CiInstallationRow = CiInstallation;
