import type { IntentSource, IssueMeta, RepoRef } from '@devdigest/shared';
import type { IntentDoc, IntentPromptInput } from '@devdigest/reviewer-core';
import { redactSecrets } from './redact.js';

/**
 * Gathers the material for the intent classifier: linked issues/tickets and
 * linked plan/spec documents referenced from the PR description.
 *
 * SSRF-safe by construction: we never fetch arbitrary URLs. Same-repo issues go
 * through the GitHub client, same-repo files through the local clone (falling
 * back to the PR's own added lines for files introduced by the PR). Everything
 * else is reported as UNRESOLVED so the intent can flag missing context instead
 * of inventing it.
 */

export const MAX_ISSUES = 3;
export const MAX_DOCS = 4;

type Unresolved = { kind: IntentSource['kind']; ref: string };

export interface GatheredSources {
  issues: NonNullable<IntentPromptInput['issues']>;
  docs: IntentDoc[];
  unresolved: Unresolved[];
}

export interface PrFileLite {
  path: string;
  patch: string | null;
}

/** Ticket keys like PROJ-123 (Jira/Linear style); skips common non-ticket tokens. */
const TICKET_DENY = new Set(['UTF', 'SHA', 'ISO', 'HTTP', 'RFC', 'CVE', 'GPT', 'MD', 'X', 'TLS', 'SSL']);
const TICKET_KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;
const DOC_PATH = /(?:^|[\s(`'"])((?:[\w.-]+\/)*(?:docs?|specs?|plans?|rfcs?|adr)\/[\w./-]+\.(?:mdx?|txt))/gi;
const URL_RE = /https?:\/\/[^\s)>\]"'`]+/gi;
const EXTERNAL_DOC_HOSTS = /(notion\.(?:so|site)|docs\.google\.com|confluence|atlassian\.net\/wiki|coda\.io|dropbox\.com\/paper)/i;
const EXTERNAL_TICKET_HOSTS = /(atlassian\.net\/browse|jira\.|linear\.app|shortcut\.com|clubhouse\.io|asana\.com|trello\.com)/i;

function docKind(ref: string): 'plan' | 'spec' {
  return /spec|rfc|prd|design|adr/i.test(ref) ? 'spec' : 'plan';
}

/** Host + path only — query strings can carry tokens. */
function safeRef(url: URL): string {
  return redactSecrets(`${url.host}${url.pathname}`.replace(/\/$/, ''));
}

/**
 * Repo-relative path from UNTRUSTED text (PR description). Returns the normalised
 * path, or null when it could escape the repo: absolute, `..` segments (also after
 * URL-decoding), backslashes, NUL bytes, or a leading `.git/`.
 */
export function safeRepoPath(raw: string): string | null {
  let p = raw;
  try {
    p = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (p.includes('\0') || p.includes('\\')) return null;
  p = p.replace(/^\.\//, '');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null;
  const segs = p.split('/');
  if (segs.some((s) => s === '..' || s === '' || s === '.')) return null;
  if (segs[0] === '.git') return null;
  return segs.join('/');
}

export interface ParsedLinks {
  issueNumbers: number[];
  repoPaths: string[];
  unresolved: Unresolved[];
}

export function parseLinks(text: string, repo: RepoRef): ParsedLinks {
  const issueNumbers = new Set<number>();
  const repoPaths = new Set<string>();
  const unresolved = new Map<string, Unresolved>();
  const addUnresolved = (u: Unresolved) => unresolved.set(`${u.kind}:${u.ref}`, u);
  const addRepoPath = (raw: string) => {
    const safe = safeRepoPath(raw);
    if (safe) repoPaths.add(safe);
    else addUnresolved({ kind: docKind(raw), ref: '(rejected unsafe path)' });
  };
  const sameRepo = (o: string, n: string) =>
    o.toLowerCase() === repo.owner.toLowerCase() && n.toLowerCase() === repo.name.toLowerCase();

  for (const m of text.matchAll(URL_RE)) {
    let url: URL;
    try {
      url = new URL(m[0].replace(/[.,;:]+$/, ''));
    } catch {
      continue;
    }
    const gh = url.host === 'github.com' || url.host === 'www.github.com';
    const segs = url.pathname.split('/').filter(Boolean);
    if (gh && segs.length >= 4 && (segs[2] === 'issues' || segs[2] === 'pull')) {
      const n = Number(segs[3]);
      if (sameRepo(segs[0]!, segs[1]!) && Number.isInteger(n)) issueNumbers.add(n);
      else addUnresolved({ kind: 'issue', ref: safeRef(url) });
    } else if (gh && segs.length >= 5 && segs[2] === 'blob') {
      const path = segs.slice(4).join('/');
      if (/\.(mdx?|txt)$/i.test(path)) {
        if (sameRepo(segs[0]!, segs[1]!)) addRepoPath(path);
        else addUnresolved({ kind: docKind(path), ref: safeRef(url) });
      }
    } else if (url.host === 'raw.githubusercontent.com' && segs.length >= 4) {
      const path = segs.slice(3).join('/');
      if (sameRepo(segs[0]!, segs[1]!)) addRepoPath(path);
      else addUnresolved({ kind: docKind(path), ref: safeRef(url) });
    } else if (EXTERNAL_TICKET_HOSTS.test(`${url.host}${url.pathname}`)) {
      addUnresolved({ kind: 'issue', ref: safeRef(url) });
    } else if (EXTERNAL_DOC_HOSTS.test(`${url.host}${url.pathname}`) || /\.(mdx?)$/i.test(url.pathname)) {
      addUnresolved({ kind: docKind(url.href), ref: safeRef(url) });
    }
  }

  for (const m of text.matchAll(DOC_PATH)) addRepoPath(m[1]!);

  // Plain "#123" / "closes #123" references (same repo).
  for (const m of text.matchAll(/(?:^|[^\w&/])#(\d{1,6})\b/g)) issueNumbers.add(Number(m[1]));

  // Ticket keys (no connector to Jira/Linear → always unresolved).
  for (const m of text.matchAll(TICKET_KEY)) {
    if (TICKET_DENY.has(m[1]!)) continue;
    addUnresolved({ kind: 'issue', ref: `${m[1]}-${m[2]}` });
  }

  return {
    issueNumbers: [...issueNumbers].slice(0, MAX_ISSUES),
    repoPaths: [...repoPaths].slice(0, MAX_DOCS),
    unresolved: [...unresolved.values()],
  };
}

/** Added lines of a file introduced by the PR itself (the plan may live in the PR). */
function textFromPatch(patch: string | null): string | null {
  if (!patch) return null;
  const lines = patch
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
  return lines.length > 0 ? lines.join('\n') : null;
}

export async function gatherSources(args: {
  /** Same-repo issue lookup (GitHub client); rejects when unavailable. */
  getIssue: (n: number) => Promise<IssueMeta>;
  /** Same-repo file read (local clone); rejects when unavailable. */
  readFile: (path: string) => Promise<string>;
  repo: RepoRef;
  headSha: string;
  title: string;
  description: string | null | undefined;
  prFiles: PrFileLite[];
}): Promise<GatheredSources> {
  const text = `${args.title}\n${args.description ?? ''}`;
  const links = parseLinks(text, args.repo);
  const issues: GatheredSources['issues'] = [];
  const docs: IntentDoc[] = [];
  const unresolved: Unresolved[] = [...links.unresolved];
  const short = args.headSha.slice(0, 7);

  await Promise.all(
    links.issueNumbers.map(async (n) => {
      try {
        const issue = await args.getIssue(n);
        issues.push({
          number: issue.number,
          title: redactSecrets(issue.title),
          body: issue.body ? redactSecrets(issue.body) : null,
          state: issue.state,
        });
      } catch {
        unresolved.push({ kind: 'issue', ref: `issue#${n}` });
      }
    }),
  );
  issues.sort((a, b) => a.number - b.number);

  for (const path of links.repoPaths) {
    if (!safeRepoPath(path)) continue; // defence in depth (parseLinks already filters)
    const kind = docKind(path);
    // A plan/spec added by THIS PR is only present in the PR's own patch.
    const inPr = args.prFiles.find((f) => f.path === path);
    let content: string | null = null;
    const patch = inPr?.patch ?? null;
    const isNewFile = patch !== null && !patch.split('\n').some((l) => l.startsWith('-') && !l.startsWith('---'));
    if (isNewFile) content = textFromPatch(patch);
    if (!content) {
      try {
        content = await args.readFile(path);
      } catch {
        content = textFromPatch(patch);
      }
    }
    if (content && content.trim()) docs.push({ kind, ref: `${path}@${short}`, text: redactSecrets(content) });
    else unresolved.push({ kind, ref: path });
  }

  return { issues, docs, unresolved };
}
