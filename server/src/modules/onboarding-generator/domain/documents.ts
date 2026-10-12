/**
 * Which repository files may become onboarding evidence. Everything read from a
 * repository is untrusted data; this module only decides what is *eligible* to
 * be read at all (the secret screen and size limits then apply on top).
 */

export type DocKind = 'readme' | 'contributing' | 'doc' | 'manifest' | 'config' | 'env_example';

const EXCLUDED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'vendor',
  'third_party',
  '.git',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  '.pnpm-store',
  '.yarn',
  '.gradle',
]);

const CREDENTIAL_EXT = /\.(?:pem|key|crt|cer|der|p12|pfx|jks|keystore|gpg|asc|kdbx)$/i;
const CREDENTIAL_NAME =
  /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|\.npmrc|\.netrc|\.pypirc|\.pgpass|credentials(?:\.[a-z]+)?|secrets?\.(?:json|ya?ml|toml|txt)|service-account[^/]*\.json)$/i;
const LOCKFILE =
  /^(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|npm-shrinkwrap\.json|cargo\.lock|poetry\.lock|pipfile\.lock|composer\.lock|gemfile\.lock|go\.sum|bun\.lockb?)$/i;
const ENV_SAFE = /^\.env\.(?:example|sample|template|dist)$/i;

/**
 * Files that carry (or are likely to carry) credentials: real `.env*` files, keys,
 * certificates and credential stores. Never readable, and never citable — not even by path.
 */
export function isCredentialPath(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  if (/^\.env(?:\..+)?$/i.test(name) && !ENV_SAFE.test(name)) return true;
  return CREDENTIAL_EXT.test(name) || CREDENTIAL_NAME.test(name);
}

/** Dependency/build/git/vendor output, credentials, keys/certificates and lockfiles (document eligibility). */
export function isExcludedPath(path: string): boolean {
  const segments = path.split('/');
  const name = segments[segments.length - 1] ?? '';
  if (segments.slice(0, -1).some((s) => EXCLUDED_SEGMENTS.has(s))) return true;
  if (isCredentialPath(path)) return true;
  if (LOCKFILE.test(name)) return true;
  return false;
}

const MANIFEST_NAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'pyproject.toml',
  'requirements.txt',
  'cargo.toml',
  'go.mod',
  'gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
]);
const CONFIG_NAME = /^(?:docker-compose(?:\.[a-z0-9-]+)?\.ya?ml|compose\.ya?ml|dockerfile|makefile|justfile|taskfile\.ya?ml)$/i;

/** Classify a repo-relative path as a candidate document, or null when it is not one. */
export function classifyDocPath(path: string): DocKind | null {
  if (isExcludedPath(path)) return null;
  const segments = path.split('/');
  const name = segments[segments.length - 1] ?? '';
  const lower = name.toLowerCase();
  const depth = segments.length - 1;

  if (ENV_SAFE.test(name) && depth <= 2) return 'env_example';
  // Root (or one-level package) manifests and local-run configuration.
  if (depth <= 1 && MANIFEST_NAMES.has(lower)) return 'manifest';
  if (depth <= 1 && CONFIG_NAME.test(name)) return 'config';
  if (/^readme(?:\.[a-z0-9]+)?$/i.test(name) && depth <= 2) return 'readme';
  if (/^contributing(?:\.[a-z0-9]+)?$/i.test(name) && depth <= 1) return 'contributing';
  // Markdown under docs/specs (any depth) and top-level repo guides (AGENTS.md, CLAUDE.md, ...).
  if (/\.(?:md|mdx)$/i.test(name)) {
    if (segments.some((s) => s === 'docs' || s === 'specs' || s === 'doc')) return 'doc';
    if (depth === 0) return 'doc';
    if (depth === 1 && /^(?:agents|claude|architecture|development|setup|install)/i.test(name)) return 'doc';
  }
  return null;
}

const KIND_PRIORITY: Record<DocKind, number> = {
  readme: 0,
  contributing: 1,
  manifest: 2,
  config: 3,
  env_example: 4,
  doc: 5,
};

/** Lower sorts first: setup-relevant documents win the (bounded) document budget. */
export function docPriority(path: string, kind: DocKind): number {
  const depth = path.split('/').length - 1;
  return KIND_PRIORITY[kind] * 10 + Math.min(depth, 9);
}

/** Valid UTF-8 text only: NUL bytes or U+FFFD substitution mean binary/invalid input (insights 2026-10-11). */
export function isReadableText(text: string): boolean {
  return !text.includes('\0') && !text.includes('�');
}

/** Cheap token estimate (chars/4) used only for bounding; the exact tokenizer is not needed here. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate to at most `maxBytes` UTF-8 bytes without splitting a code point. */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  // Back up to a code-point boundary (continuation bytes are 10xxxxxx).
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end -= 1;
  return { text: buf.subarray(0, end).toString('utf8'), truncated: true };
}
