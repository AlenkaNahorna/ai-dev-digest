/**
 * Secret screening for repository-controlled evidence (security A06/A09).
 *
 * Deliberately a small, versioned, SPECIFIC rule set — not a generic "looks
 * random" scanner — so false positives stay bounded. Screening runs BEFORE any
 * text reaches the prompt, and the model output is screened again before it is
 * stored or shared.
 *
 *  - private-key blocks and secret-dense documents are excluded whole;
 *  - any other matching line inside an otherwise allowed document is redacted
 *    and counted in the evidence report.
 */

export const SECRET_RULES_VERSION = 1;

interface Rule {
  id: string;
  pattern: RegExp;
  /** Excludes the entire document instead of redacting a line. */
  excludesDocument?: boolean;
}

const RULES: Rule[] = [
  {
    id: 'private-key-block',
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/,
    excludesDocument: true,
  },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/ },
  { id: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: 'llm-api-key', pattern: /\bsk-(?:ant-|or-v1-|proj-)?[A-Za-z0-9_-]{24,}\b/ },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { id: 'authorization-header', pattern: /\bAuthorization\s*:\s*(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/i },
  // Credentials embedded in a URL. Local-development hosts (localhost/loopback) are the
  // documented dev-default pattern (e.g. postgres://user:pass@localhost) and are not secrets.
  {
    id: 'url-credentials',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@'"]+:[^/\s@'"]{3,}@(?!localhost\b|127\.0\.0\.1|0\.0\.0\.0|\[::1\])[^\s'"]+/i,
  },
];

/** `NAME_KEY=value` style assignments (env files, yaml, json, shell, docs). */
const ASSIGNMENT = /\b([A-Za-z0-9_.-]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*["']?([^\s"'`,;]{16,})/i;

/** Values that are placeholders, references or templates — never real secrets. */
const PLACEHOLDER =
  /^(?:your[_-]|<|\$|\{|%|\*+$|x{4,}|\.{3}|changeme|change[_-]me|example|placeholder|dummy|test|todo|none|null|undefined|process\.env|env\.|secrets\.|\[)/i;
const PLACEHOLDER_ANYWHERE = /(?:your[_-]?(?:api[_-]?)?(?:key|token|secret)|<[^>]*>|\$\{[^}]*\}|\.\.\.|x{6,}|example|placeholder|redacted)/i;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** A pure hex digest (git sha, sha256 in a lockfile) is a hash, not a credential. */
const HEX_DIGEST = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{128})$/i;

function isHighEntropyAssignment(line: string): boolean {
  const m = ASSIGNMENT.exec(line);
  if (!m) return false;
  const value = m[2]!;
  if (PLACEHOLDER.test(value) || PLACEHOLDER_ANYWHERE.test(value)) return false;
  if (HEX_DIGEST.test(value)) return false;
  // Looks like a path/URL/identifier rather than a secret.
  if (/^[./~]/.test(value) || /^https?:\/\//i.test(value)) return false;
  return shannonEntropy(value) >= 3.2;
}

export type LineFinding = { line: number; rule: string };

/** Which rule (if any) flags a single line. */
export function classifyLine(line: string): string | null {
  for (const rule of RULES) {
    if (rule.excludesDocument) continue;
    const m = rule.pattern.exec(line);
    // A hit is benign only when the matched text itself is a template/placeholder.
    if (m && !PLACEHOLDER_ANYWHERE.test(m[0])) return rule.id;
  }
  if (isHighEntropyAssignment(line)) return 'high-entropy-assignment';
  return null;
}

export const REDACTED_LINE = '[line redacted: possible secret]';
/** A document with this many flagged lines is considered secret-dense and excluded whole. */
export const SECRET_DENSE_THRESHOLD = 3;

export type ScreenResult =
  | { action: 'exclude'; reason: string }
  | { action: 'ok'; text: string; redactedLines: number };

/** Screen a document's text. Never returns the original text of a flagged line. */
export function screenDocument(text: string): ScreenResult {
  for (const rule of RULES) {
    if (rule.excludesDocument && rule.pattern.test(text)) {
      return { action: 'exclude', reason: rule.id };
    }
  }
  const lines = text.split('\n');
  let redacted = 0;
  const out = lines.map((line) => {
    if (classifyLine(line)) {
      redacted += 1;
      return REDACTED_LINE;
    }
    return line;
  });
  if (redacted >= SECRET_DENSE_THRESHOLD) return { action: 'exclude', reason: 'secret-dense' };
  return { action: 'ok', text: out.join('\n'), redactedLines: redacted };
}

/** True when `text` (e.g. model output) contains anything the rules would flag. */
export function containsSecret(text: string): boolean {
  if (RULES.some((r) => r.excludesDocument && r.pattern.test(text))) return true;
  return text.split('\n').some((line) => classifyLine(line) !== null);
}

/**
 * `.env.example`-style files may only contribute variable NAMES / placeholders:
 * everything after `=` is dropped so no value (even a "sample" one) is kept.
 */
export function reduceEnvExample(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t === '' || t.startsWith('#')) return line;
      const eq = t.indexOf('=');
      if (eq === -1) return line;
      const name = t.slice(0, eq).replace(/^export\s+/, '');
      return `${name}=`;
    })
    .join('\n');
}
