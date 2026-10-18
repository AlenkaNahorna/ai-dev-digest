import type { CiRunRow } from "./types";

/**
 * Response-boundary guard for `GET /ci-runs`. The client imports only TYPES
 * from vendored shared, so the structural check the list relies on lives here:
 * a drifted/hostile payload becomes a clear error instead of a broken table.
 * The server remains the authority on full validation.
 */
export class UnexpectedResponseError extends Error {
  constructor(what: string) {
    super(`Unexpected ${what} response from the server.`);
    this.name = "UnexpectedResponseError";
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A row needs a stable id for the list key; everything else is nullable for display. */
function validRun(r: unknown): r is CiRunRow {
  return isObj(r) && typeof r.id === "string";
}

export function parseCiRuns(raw: unknown): CiRunRow[] {
  if (!Array.isArray(raw) || !raw.every(validRun)) {
    throw new UnexpectedResponseError("CI runs");
  }
  return raw as unknown as CiRunRow[];
}
