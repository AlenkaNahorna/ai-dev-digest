/** Default blocking limit of `run_agent_on_pr` (plan step 6, owner decision). */
export const DEFAULT_WAIT_MS = 120_000;
export const MIN_WAIT_MS = 1_000;
export const MAX_WAIT_MS = 600_000;

/**
 * Parses `DEVDIGEST_MCP_WAIT_MS`. Unset or blank → default. Anything that is not
 * a plain integer within [MIN_WAIT_MS, MAX_WAIT_MS] throws: a typo must not
 * silently turn into a 0 ms or multi-hour wait. The message is for the operator
 * (startup failure on stderr), not for the model.
 */
export function parseWaitMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_WAIT_MS;
  const text = raw.trim();
  const value = /^\d{1,9}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(value) || value < MIN_WAIT_MS || value > MAX_WAIT_MS) {
    throw new Error(
      `DEVDIGEST_MCP_WAIT_MS must be an integer between ${MIN_WAIT_MS} and ${MAX_WAIT_MS} (milliseconds), got ${JSON.stringify(text.slice(0, 40))}`,
    );
  }
  return value;
}
