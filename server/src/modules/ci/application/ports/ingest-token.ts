/**
 * Port for generating + verifying the per-installation ingest bearer token
 * (AC-7, AC-15). The concrete adapter uses Node `crypto` (CSPRNG + SHA-256 +
 * constant-time compare) — see `adapters/outbound/providers/ingest-token.ts`.
 * Application code depends only on this interface, never on `node:crypto`.
 *
 * Security (`security` skill A04/A07/A09):
 *   - `generate()` returns a fresh CSPRNG plaintext token AND its hash; only the
 *     hash is ever persisted, the plaintext is shown to the member exactly once.
 *   - `hash()` is a plain SHA-256 hex — the token is a 256-bit random secret, so
 *     a fast hash is adequate (no salt/stretching needed for high-entropy keys).
 *   - `verify()` compares in constant time to avoid timing side channels, and
 *     callers must reject generically (no "unknown token" vs "bad token" leak).
 */

export interface GeneratedToken {
  /** Plaintext token — returned to the caller ONCE, never persisted. */
  plaintext: string;
  /** SHA-256 hex of the plaintext — the only value stored (`token_hash`). */
  hash: string;
}

export interface IngestTokenPort {
  generate(): GeneratedToken;
  hash(plaintext: string): string;
  /** Constant-time equality of the SHA-256 hashes of `plaintext` and `hash`. */
  verify(plaintext: string, hash: string): boolean;
}
