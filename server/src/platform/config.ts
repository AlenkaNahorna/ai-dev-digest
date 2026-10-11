import 'dotenv/config';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';

/**
 * Central, zod-validated environment config. Loaded once at startup.
 *
 * NOTE: secret keys (OPENAI/ANTHROPIC/OPENROUTER/GITHUB_TOKEN) are deliberately
 * NOT in this schema. Feature code must access secrets through SecretsProvider,
 * never via process.env or AppConfig — the SecretsProvider is the one chokepoint
 * that reads process.env directly (see adapters/secrets/local.ts). Listing them
 * here would be dead config that never reaches AppConfig.
 */
/** Default Project Context search roots (folder names, matched at any depth). */
export const DEFAULT_PROJECT_CONTEXT_ROOTS = ['specs', 'docs', 'insights'] as const;
export const DEFAULT_PROJECT_CONTEXT_WARN_TOKENS = 100_000;

/** A root is a single plain folder name — no separators, traversal or glob characters. */
const ROOT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function parseProjectContextRoots(raw: string | undefined): string[] {
  const names = (raw ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (names.length === 0) return [...DEFAULT_PROJECT_CONTEXT_ROOTS];
  for (const n of names) {
    if (n !== '*' && (!ROOT_NAME.test(n) || n === '.' || n === '..')) {
      throw new Error(`PROJECT_CONTEXT_ROOTS: "${n}" is not a plain folder name (or * for all)`);
    }
  }
  return [...new Set(names)];
}

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .default('postgres://devdigest:devdigest@localhost:5555/devdigest'),
  // Memory/RAG embeddings run on OpenAI (text-embedding-3-small, 1536-dim — the
  // pgvector columns are locked to that). Default OFF so the app makes ZERO
  // OpenAI requests; set EMBEDDINGS_ENABLED=true to turn memory retrieval on.
  EMBEDDINGS_ENABLED: z.string().optional(),
  // repo-intel facade (Tier 1). Default ON — reviews get repo skeleton +
  // callers context. Set REPO_INTEL_ENABLED=false to opt out, in which case
  // every consumer degrades to ripgrep-identical behavior (acceptance #10).
  // Note: even when on, sections only populate once the repo is indexed; an
  // unindexed repo degrades gracefully. Per-agent override: agents.repo_intel.
  REPO_INTEL_ENABLED: z.string().optional(),
  // LOCAL-ONLY diagnostic: `true` adds per-section hashes/line counts and short
  // redacted previews of a few safe sections to the SERVER'S STDOUT log while
  // prompts are assembled. Honoured only when NODE_ENV=development; ignored (with
  // a warning) elsewhere. Never streamed to the UI or persisted.
  DEVDIGEST_PROMPT_LOG_VERBOSE: z.string().optional(),
  // Project Context: comma-separated FOLDER NAMES (not globs) whose `.md` files
  // are discoverable at any depth of the synced clone. Blank → the default set.
  PROJECT_CONTEXT_ROOTS: z.string().optional(),
  // Attached-total token threshold above which the UI warns (never truncates).
  PROJECT_CONTEXT_WARN_TOKENS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().positive().default(DEFAULT_PROJECT_CONTEXT_WARN_TOKENS),
  ),
  // Onboarding generator. PUBLIC_WEB_ORIGIN is the externally reachable ORIGIN of the
  // web app used to build share links (never derived from a request Host header).
  // https only, no path/query/credentials; http://localhost[:port] is accepted
  // outside production. Unset → share links are local-only.
  PUBLIC_WEB_ORIGIN: z.string().optional(),
  ONBOARDING_AUTO_GENERATE: z.string().optional(),
  ONBOARDING_DAILY_BUDGET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).max(1000).default(10),
  ),
  ONBOARDING_RETAINED_VERSIONS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).max(50).default(5),
  ),
  API_PORT: z.coerce.number().int().default(3001),
  WEB_PORT: z.coerce.number().int().default(3000),
  DEVDIGEST_CLONE_DIR: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // `.env` (and .env.example) ship `LOG_LEVEL=` empty; an empty string is not a
  // valid enum member, so coerce '' → undefined to fall through to the default.
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
});

export type AppConfig = {
  databaseUrl: string;
  apiPort: number;
  webPort: number;
  /** Absolute path where repos are cloned (~/.devdigest/workspace by default). */
  cloneDir: string;
  /** Absolute path to the writable secrets store (BYO keys from the UI). */
  secretsPath: string;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Allowed CORS origin for the Next.js dev server. */
  webOrigin: string;
  /** Whether memory/RAG embeddings (OpenAI) are enabled. Default false. */
  embeddingsEnabled: boolean;
  /**
   * Whether the repo-intel facade (Tier 1: phantom-gate, callers-in-prompt) is
   * active. Default ON — set REPO_INTEL_ENABLED=false to opt out, in which case
   * every facade method returns its degraded result (`[]`) so consumers behave
   * EXACTLY like the ripgrep-only baseline.
   */
  repoIntelEnabled: boolean;
  /** Project Context search roots: folder names matched at any depth of the clone. */
  projectContextRoots: string[];
  /** Attached-total token threshold above which the UI shows a warning (no truncation). */
  projectContextWarnTokens: number;
  /** Validated public web origin for share links, or null (links are then local-only). */
  publicWebOrigin: string | null;
  /** Generate a tour automatically after a usable index completes. Default true. */
  onboardingAutoGenerate: boolean;
  /** Per-repository cap on onboarding generation requests per 24h. */
  onboardingDailyBudget: number;
  /** Newest tour versions kept per repository (plus any version a share references). */
  onboardingRetainedVersions: number;
  /** Verbose prompt-composition logging (dev only, stdout only). See EnvSchema. */
  promptLogVerbose: boolean;
  /** Verbose was requested but ignored because this is not a local dev run. */
  promptLogVerboseIgnored: boolean;
};

/** Strict origin parse: absolute, no path/query/hash/credentials; https (or http://localhost outside production). */
export function parsePublicWebOrigin(raw: string | undefined, nodeEnv: string): string | null {
  const v = (raw ?? '').trim();
  if (v === '') return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error('PUBLIC_WEB_ORIGIN must be an absolute origin such as https://devdigest.example.com');
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    throw new Error('PUBLIC_WEB_ORIGIN must be an origin only (no path, query, fragment or credentials)');
  }
  const localHttp = u.protocol === 'http:' && u.hostname === 'localhost' && nodeEnv !== 'production';
  if (u.protocol !== 'https:' && !localHttp) {
    throw new Error('PUBLIC_WEB_ORIGIN must use https (http://localhost is allowed outside production)');
  }
  return u.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const promptLogRequested = parsed.DEVDIGEST_PROMPT_LOG_VERBOSE === 'true';
  const cloneDirRaw =
    parsed.DEVDIGEST_CLONE_DIR ?? join(homedir(), '.devdigest', 'workspace');
  const cloneDir = isAbsolute(cloneDirRaw) ? cloneDirRaw : resolve(process.cwd(), cloneDirRaw);
  return {
    databaseUrl: parsed.DATABASE_URL,
    apiPort: parsed.API_PORT,
    webPort: parsed.WEB_PORT,
    cloneDir,
    secretsPath: join(homedir(), '.devdigest', 'secrets.json'),
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info'),
    webOrigin: `http://localhost:${parsed.WEB_PORT}`,
    embeddingsEnabled: parsed.EMBEDDINGS_ENABLED === 'true',
    repoIntelEnabled: parsed.REPO_INTEL_ENABLED !== 'false',
    projectContextRoots: parseProjectContextRoots(parsed.PROJECT_CONTEXT_ROOTS),
    projectContextWarnTokens: parsed.PROJECT_CONTEXT_WARN_TOKENS,
    publicWebOrigin: parsePublicWebOrigin(parsed.PUBLIC_WEB_ORIGIN, parsed.NODE_ENV),
    onboardingAutoGenerate: parsed.ONBOARDING_AUTO_GENERATE !== 'false',
    onboardingDailyBudget: parsed.ONBOARDING_DAILY_BUDGET,
    onboardingRetainedVersions: parsed.ONBOARDING_RETAINED_VERSIONS,
    promptLogVerbose: promptLogRequested && parsed.NODE_ENV === 'development',
    promptLogVerboseIgnored: promptLogRequested && parsed.NODE_ENV !== 'development',
  };
}
