import type { CiResultArtifact } from '@devdigest/shared';
import type { FetchLike } from './github.js';

/**
 * POST the result artifact back to the studio ingest endpoint (AC-15):
 * `POST $DEVDIGEST_API_URL/ci/ingest` with `Authorization: Bearer
 * $DEVDIGEST_INGEST_TOKEN`. Best-effort: ingest is a side channel back to the
 * studio, so a non-2xx or network failure is reported (returned) but does NOT
 * change the CI exit code — the GitHub review + deterministic gate already
 * decided pass/fail. The bearer token is NEVER logged and never written to the
 * artifact (`security` skill A09/A14): this module only forwards it in the
 * Authorization header.
 */

const INGEST_PATH = '/ci/ingest';

export interface IngestResult {
  ok: boolean;
  status: number | null;
  error?: string;
}

export async function postIngest(
  apiUrl: string,
  token: string,
  artifact: CiResultArtifact,
  fetchImpl: FetchLike = fetch,
): Promise<IngestResult> {
  const base = apiUrl.replace(/\/+$/, '');
  const url = `${base}${INGEST_PATH}`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(artifact),
      // Ingest is best-effort: an unreachable studio/tunnel must not hang the job.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Do NOT echo the request (it contains no secret, but keep the log terse);
      // never log the Authorization header / token.
      return { ok: false, status: res.status, error: `ingest responded ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: null, error: (err as Error).message };
  }
}
