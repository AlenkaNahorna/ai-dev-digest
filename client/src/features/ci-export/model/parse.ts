import type { CiExportResult, CiInstallationRow } from "./types";
import type { CiFile } from "@devdigest/shared";

/**
 * Response-boundary guards. The client may import only TYPES from the vendored
 * shared package (a runtime import drags its barrel into webpack), so the
 * structural checks the CI tab / export dialog rely on are enforced here. A
 * drifted or hostile payload becomes a clear error instead of a half-rendered
 * UI; the server remains the authority on full validation.
 */
export class UnexpectedResponseError extends Error {
  constructor(what: string) {
    super(`Unexpected ${what} response from the server.`);
    this.name = "UnexpectedResponseError";
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function validFile(f: unknown): f is CiFile {
  return isObj(f) && typeof f.path === "string" && typeof f.contents === "string";
}

function validInstallation(i: unknown): i is CiInstallationRow {
  return (
    isObj(i) &&
    typeof i.id === "string" &&
    typeof i.agent_id === "string" &&
    typeof i.repo === "string"
  );
}

/** Guard the `POST /agents/:id/export-ci` response (files + pr_url + optional
 *  installation/token). The preview (`action: "files"`, AC-2) returns files only
 *  with `installation: null` and no token, so the installation is optional; when
 *  present it must be well-formed. */
export function parseCiExport(raw: unknown): CiExportResult {
  const installationOk =
    raw != null && isObj(raw) && (raw.installation == null || validInstallation(raw.installation));
  if (!isObj(raw) || !installationOk || !Array.isArray(raw.files) || !raw.files.every(validFile)) {
    throw new UnexpectedResponseError("CI export");
  }
  return raw as unknown as CiExportResult;
}

/** Guard the `GET /agents/:id/ci-installations` response (an array of installations). */
export function parseCiInstallations(raw: unknown): CiInstallationRow[] {
  if (!Array.isArray(raw) || !raw.every(validInstallation)) {
    throw new UnexpectedResponseError("CI installations");
  }
  return raw as unknown as CiInstallationRow[];
}
