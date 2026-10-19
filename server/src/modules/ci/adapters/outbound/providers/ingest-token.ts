import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { GeneratedToken, IngestTokenPort } from '../../../application/ports/ingest-token.js';

/**
 * CSPRNG ingest-token adapter (onion outbound). Implements `IngestTokenPort`
 * using Node `crypto` only (no other module reads `node:crypto`). Security
 * (`security` skill):
 *   - A04: `generate()` produces a 256-bit (32-byte) token from `randomBytes`
 *     (CSPRNG) and persists ONLY its SHA-256 hex; the plaintext is returned to
 *     the caller once and never stored/logged.
 *   - A07: `verify()` hashes the presented token and compares with
 *     `timingSafeEqual` (constant time) to avoid a timing side channel.
 */
export class CryptoIngestToken implements IngestTokenPort {
  generate(): GeneratedToken {
    const plaintext = randomBytes(32).toString('hex');
    return { plaintext, hash: this.hash(plaintext) };
  }

  hash(plaintext: string): string {
    return createHash('sha256').update(plaintext, 'utf8').digest('hex');
  }

  verify(plaintext: string, hash: string): boolean {
    const presented = Buffer.from(this.hash(plaintext), 'hex');
    const stored = Buffer.from(hash, 'hex');
    // Lengths differ only if `hash` is not a 32-byte SHA-256 hex — reject
    // without calling timingSafeEqual (which throws on length mismatch).
    if (presented.length !== stored.length) return false;
    return timingSafeEqual(presented, stored);
  }
}
