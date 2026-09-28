import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/modules/reviews/intent/redact.js';
import { parseLinks, gatherSources, safeRepoPath } from '../src/modules/reviews/intent/sources.js';

const repo = { owner: 'acme', name: 'payments-api' };

describe('redactSecrets', () => {
  it('removes common secret shapes', () => {
    const text = [
      'stripe sk_live_51Habcdef1234567890',
      'gh ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'aws AKIAABCDEFGHIJKLMNOP',
      'API_KEY = "supersecretvalue123"',
      'Authorization: Bearer abcdef123456',
      'jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4',
    ].join('\n');
    const out = redactSecrets(text);
    for (const leak of ['sk_live_51H', 'ghp_abcdef', 'AKIAABCDEF', 'supersecretvalue123', 'abcdef123456', 'eyJhbGciOiJIUzI1']) {
      expect(out).not.toContain(leak);
    }
    expect(out).toContain('[REDACTED]');
  });

  it('leaves ordinary prose alone', () => {
    expect(redactSecrets('Add rate limiting to /api/public/*')).toBe('Add rate limiting to /api/public/*');
  });
});

describe('parseLinks', () => {
  it('finds same-repo issues, in-repo plan/spec paths and blob links', () => {
    const l = parseLinks(
      'Closes #471. Plan: docs/plans/2026-rate-limit.md and https://github.com/acme/payments-api/blob/main/specs/rl.md',
      repo,
    );
    expect(l.issueNumbers).toContain(471);
    expect(l.repoPaths).toEqual(expect.arrayContaining(['docs/plans/2026-rate-limit.md', 'specs/rl.md']));
  });

  it('reports external docs and tickets as unresolved (never fetched), without query strings', () => {
    const l = parseLinks(
      'Spec https://www.notion.so/team/RL-spec?token=abc123 ticket PAY-88 and https://github.com/other/repo/issues/5',
      repo,
    );
    const refs = l.unresolved.map((u) => u.ref);
    expect(refs).toContain('www.notion.so/team/RL-spec');
    expect(refs).toContain('PAY-88');
    expect(refs).toContain('github.com/other/repo/issues/5');
    expect(refs.join(' ')).not.toContain('abc123');
  });

  it('ignores non-ticket tokens like UTF-8', () => {
    expect(parseLinks('encoding UTF-8 and SHA-256', repo).unresolved).toEqual([]);
  });
});

describe('gatherSources', () => {
  const base = { repo, headSha: 'abcdef123456', title: 't', prFiles: [] };

  it('fetches same-repo issue + plan, redacting secrets in fetched text', async () => {
    const g = await gatherSources({
      ...base,
      description: 'Closes #12, plan docs/plans/rl.md',
      getIssue: async (n) => ({ number: n, title: 'Abuse', body: 'key sk_live_51Habcdef1234567890', state: 'open' }),
      readFile: async () => '# Plan\nStep 1',
    });
    expect(g.issues[0]!.body).not.toContain('sk_live_51H');
    expect(g.docs).toEqual([{ kind: 'plan', ref: 'docs/plans/rl.md@abcdef1', text: '# Plan\nStep 1' }]);
    expect(g.unresolved).toEqual([]);
  });

  it('does not invent content: failed fetches become unresolved', async () => {
    const g = await gatherSources({
      ...base,
      description: 'Closes #12, plan docs/plans/rl.md',
      getIssue: async () => {
        throw new Error('404');
      },
      readFile: async () => {
        throw new Error('ENOENT');
      },
    });
    expect(g.issues).toEqual([]);
    expect(g.docs).toEqual([]);
    expect(g.unresolved).toEqual(
      expect.arrayContaining([
        { kind: 'issue', ref: 'issue#12' },
        { kind: 'plan', ref: 'docs/plans/rl.md' },
      ]),
    );
  });

  it('uses the PR\'s own added lines for a plan introduced by the PR', async () => {
    const g = await gatherSources({
      ...base,
      description: 'plan: docs/plans/new.md',
      prFiles: [{ path: 'docs/plans/new.md', patch: '@@ -0,0 +1,2 @@\n+# New plan\n+Do the thing' }],
      getIssue: async () => {
        throw new Error('x');
      },
      readFile: async () => {
        throw new Error('not in clone');
      },
    });
    expect(g.docs[0]!.text).toBe('# New plan\nDo the thing');
  });
});

describe('safeRepoPath / traversal', () => {
  it('rejects paths that could escape the repo', () => {
    for (const bad of [
      'docs/../../otherorg/otherrepo/docs/secret.md',
      '../docs/x.md',
      '/etc/notes.txt',
      'docs/%2e%2e/%2e%2e/x.md',
      'docs\\..\\x.md',
      'docs/a\0.md',
      '.git/docs/x.md',
      'docs//x.md',
    ]) {
      expect(safeRepoPath(bad), bad).toBeNull();
    }
    expect(safeRepoPath('docs/plans/rate-limit.md')).toBe('docs/plans/rate-limit.md');
    expect(safeRepoPath('./docs/spec.md')).toBe('docs/spec.md');
  });

  it('parseLinks never yields traversal paths; they are flagged unresolved', () => {
    const r = parseLinks(
      'Plan: docs/../../otherorg/otherrepo/docs/secret.md and https://github.com/acme/payments-api/blob/main/docs/..%2f..%2fx/secret.md',
      repo,
    );
    expect(r.repoPaths).toEqual([]);
    expect(r.unresolved.length).toBeGreaterThan(0);
  });

  it('gatherSources never calls readFile for an unsafe path', async () => {
    let called = 0;
    const g = await gatherSources({
      getIssue: async () => { throw new Error('none'); },
      readFile: async () => { called++; return 'SECRET'; },
      repo, headSha: 'abcdef123456', title: 't',
      description: 'see docs/../../other/docs/secret.md',
      prFiles: [],
    });
    expect(called).toBe(0);
    expect(g.docs).toEqual([]);
  });
});
