/**
 * Secret redaction for text that leaves the process (classifier prompt) or is
 * logged. Best-effort pattern matching: PR text can contain pasted keys (a
 * committed Stripe key is a classic), and the classifier must not receive them.
 */

const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, // Stripe
  /\bsk-(?:ant-|or-)?[A-Za-z0-9_-]{16,}\b/g, // OpenAI / Anthropic / OpenRouter
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAIza[A-Za-z0-9_-]{30,}\b/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
];

/** `api_key = "..."`, `password: xyz`, `Authorization: Bearer ...` */
const ASSIGNMENT =
  /\b((?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|token|passwd|password|authorization)\s*[:=]\s*)(?:Bearer\s+)?["']?[^\s"',;]{6,}["']?/gi;

export const REDACTED = '[REDACTED]';

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  return out.replace(ASSIGNMENT, `$1${REDACTED}`);
}
