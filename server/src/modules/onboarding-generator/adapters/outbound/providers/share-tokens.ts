import { createHash, randomBytes } from 'node:crypto';
import type { ShareTokens } from '../../../application/ports/onboarding-ports.js';
import { SHARE_TOKEN_BYTES } from '../../../domain/limits.js';

/** 32 random bytes → 43-char base64url token; only the SHA-256 digest is ever stored. */
export class CryptoShareTokens implements ShareTokens {
  create(): { token: string; digest: string } {
    const token = randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
    return { token, digest: this.digest(token) };
  }
  digest(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
