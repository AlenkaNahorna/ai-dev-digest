import { describe, expect, it } from 'vitest';
import { isSafeRelativePath, OnboardingTourContent } from '../src/vendor/shared/contracts/onboarding-generator.js';
import { classifyDocPath, isExcludedPath, isReadableText, truncateUtf8 } from '../src/modules/onboarding-generator/domain/documents.js';
import { containsSecret, reduceEnvExample, screenDocument } from '../src/modules/onboarding-generator/domain/secret-screen.js';
import { stripUnsafeLinks, toSingleLine } from '../src/modules/onboarding-generator/domain/sanitize.js';
import { automaticIdentityKey, manualIdentityKey } from '../src/modules/onboarding-generator/domain/lifecycle.js';
import { buildTourContent, commandSupported, isUsableTour } from '../src/modules/onboarding-generator/domain/build-content.js';
import { parsePublicWebOrigin } from '../src/platform/config.js';
import { CryptoShareTokens } from '../src/modules/onboarding-generator/adapters/outbound/providers/share-tokens.js';
import { ShareToken } from '../src/vendor/shared/contracts/onboarding-generator.js';

import { SHA, evidence, model } from './helpers/onboarding-fixtures.js';

describe('paths and documents', () => {
  it('rejects unsafe relative paths', () => {
    for (const p of ['', '/etc/passwd', '../x', 'a/../b', 'a\\b', 'C:\\x', 'a\0b', 'a//b']) {
      expect(isSafeRelativePath(p), p).toBe(false);
    }
    expect(isSafeRelativePath('src/app.ts')).toBe(true);
  });
  it('excludes secret-bearing and vendor paths, classifies docs', () => {
    expect(isExcludedPath('.env')).toBe(true);
    expect(isExcludedPath('node_modules/x/README.md')).toBe(true);
    expect(isExcludedPath('keys/id_rsa')).toBe(true);
    expect(classifyDocPath('README.md')).toBe('readme');
    expect(classifyDocPath('.env.example')).toBe('env_example');
    expect(classifyDocPath('src/app.ts')).toBeNull();
  });
  it('detects binary/invalid text and truncates on code-point boundaries', () => {
    expect(isReadableText('ok')).toBe(true);
    expect(isReadableText('a\0b')).toBe(false);
    expect(isReadableText('bad\uFFFD')).toBe(false);
    const r = truncateUtf8('ééé', 3);
    expect(r.truncated).toBe(true);
    expect(r.text).toBe('é');
  });
});

describe('secret screening', () => {
  it('excludes private keys whole and redacts known token shapes', () => {
    expect(screenDocument('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----').action).toBe('exclude');
    const out = screenDocument(`hello\nGITHUB_TOKEN=ghp_${'a'.repeat(36)}\nbye`);
    expect(out.action).toBe('ok');
    if (out.action === 'ok') {
      expect(out.text).not.toContain('ghp_');
      expect(out.redactedLines).toBe(1);
    }
  });
  it('excludes secret-dense documents', () => {
    const doc = [`AKIA${'A'.repeat(16)}`, `ghp_${'b'.repeat(36)}`, `xoxb-${'1'.repeat(12)}-${'c'.repeat(24)}`].join('\n');
    expect(screenDocument(doc).action).toBe('exclude');
  });
  it('keeps placeholders and loopback URLs, detects model output secrets', () => {
    expect(containsSecret('API_KEY=your-api-key-here')).toBe(false);
    expect(containsSecret('postgres://user:pw@localhost:5432/db')).toBe(false);
    expect(containsSecret('postgres://user:s3cretpw@db.internal.corp.net/db')).toBe(true);
  });
  it('reduces .env.example values to names', () => {
    const r = reduceEnvExample('# c\nDATABASE_URL=postgres://u:p@h/db\nPORT=3000');
    expect(r).not.toContain('postgres://');
    expect(r).toContain('DATABASE_URL');
  });
});

describe('sanitizing', () => {
  it('strips unsafe links and collapses to a single line', () => {
    const t = stripUnsafeLinks('see [x](javascript:alert(1)) and [ok](https://example.com)');
    expect(t).not.toContain('javascript:');
    expect(toSingleLine('a\n\nb\tc')).toBe('a b c');
  });
});

describe('request identity', () => {
  it('automatic identity is stable per index; manual never collides', () => {
    const id = { sourceSha: SHA, indexerVersion: 1, indexStatus: 'full' as const };
    expect(automaticIdentityKey(id)).toBe(automaticIdentityKey({ ...id }));
    expect(automaticIdentityKey(id)).not.toBe(automaticIdentityKey({ ...id, indexStatus: 'partial' }));
    expect(manualIdentityKey(id, 'a')).not.toBe(manualIdentityKey(id, 'b'));
  });
});

describe('grounded content building', () => {
  it('builds a valid five-section tour from grounded output', () => {
    const built = buildTourContent(model(), evidence());
    expect(OnboardingTourContent.safeParse(built.content).success).toBe(true);
    expect(built.degraded).toEqual([]);
    expect(isUsableTour(built.content)).toBe(true);
    expect(built.content.sections.map((s) => s.key)).toEqual([
      'architecture', 'critical_paths', 'local_run', 'reading_path', 'first_tasks',
    ]);
  });

  it('drops ungrounded paths and unsupported commands, degrading only that section', () => {
    const m = model({
      critical_paths: { unavailable_reason: null, entries: [{ path: 'src/ghost.ts', role: 'Nope' }] },
      local_run: {
        unavailable_reason: null,
        steps: [{ order: 1, instruction: 'Wipe', command: 'rm -rf /', source: 'README.md' }],
      },
    });
    const built = buildTourContent(m, evidence());
    const crit = built.content.sections.find((s) => s.key === 'critical_paths')!;
    const run = built.content.sections.find((s) => s.key === 'local_run')!;
    expect(crit.status).toBe('unavailable');
    expect(JSON.stringify(run)).not.toContain('rm -rf');
    expect(built.content.sections.find((s) => s.key === 'architecture')!.status).toBe('available');
  });

  it('does not store model output that contains a secret', () => {
    const m = model();
    m.architecture.summary = `Uses token ghp_${'z'.repeat(36)} to deploy.`;
    const built = buildTourContent(m, evidence());
    expect(JSON.stringify(built.content)).not.toContain('ghp_');
  });

  it('marks sections without evidence unavailable regardless of model claims', () => {
    const e = evidence({ rankedFiles: [], criticalChains: [], symbols: [], documents: [] });
    const built = buildTourContent(model(), e);
    expect(built.content.sections.every((s) => s.status === 'unavailable')).toBe(true);
    expect(isUsableTour(built.content)).toBe(false);
  });

  it('only keeps diagram edges the graph supports', () => {
    const m = model();
    m.architecture.diagram_edges.push({ from: 'db', to: 'app', label: null }); // reverse: unsupported
    const built = buildTourContent(m, evidence());
    const arch = built.content.sections.find((s) => s.key === 'architecture')!;
    if (arch.status !== 'available') throw new Error('architecture unavailable');
    const edges = arch.diagram?.edges ?? [];
    expect(edges.some((e) => e.from === 'db' && e.to === 'app')).toBe(false);
  });

  it('commandSupported checks package scripts and rejects unknown scripts', () => {
    const pkg = evidence().documents[1]!;
    expect(commandSupported('pnpm run dev', pkg)).toBe(true);
    expect(commandSupported('pnpm install', pkg)).toBe(true);
    expect(commandSupported('pnpm run deploy', pkg)).toBe(false);
  });
});

describe('PUBLIC_WEB_ORIGIN', () => {
  it('accepts https origins and local http outside production', () => {
    expect(parsePublicWebOrigin('https://app.example.com', 'production')).toBe('https://app.example.com');
    expect(parsePublicWebOrigin('http://localhost:3005', 'development')).toBe('http://localhost:3005');
    expect(parsePublicWebOrigin('', 'production')).toBeNull();
    expect(parsePublicWebOrigin(undefined, 'production')).toBeNull();
  });
  it('rejects paths, credentials, plain http in production and non-URLs', () => {
    for (const bad of ['https://a.com/x', 'https://u:p@a.com', 'http://a.com', 'a.com', 'https://a.com?x=1']) {
      expect(() => parsePublicWebOrigin(bad, 'development'), bad).toThrow();
    }
    expect(() => parsePublicWebOrigin('http://localhost:3005', 'production')).toThrow();
  });
});

describe('share tokens', () => {
  it('creates 43-char base64url tokens whose digest is stable and never the token', () => {
    const t = new CryptoShareTokens();
    const a = t.create();
    expect(ShareToken.safeParse(a.token).success).toBe(true);
    expect(a.digest).toBe(t.digest(a.token));
    expect(a.digest).not.toContain(a.token);
    expect(t.create().token).not.toBe(a.token);
  });
});
