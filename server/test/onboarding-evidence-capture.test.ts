import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexedEvidenceCapture } from '../src/modules/onboarding-generator/adapters/outbound/providers/evidence-capture.js';
import { GitRevisionReader } from '../src/modules/onboarding-generator/adapters/outbound/providers/git-revision-reader.js';
import { RepoIntelIndexReader, type RepoIntelReads } from '../src/modules/onboarding-generator/adapters/outbound/providers/index-reader.js';
import type { RepoRecord } from '../src/modules/onboarding-generator/application/ports/onboarding-ports.js';

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();

describe('IndexedEvidenceCapture', () => {
  let dir = '';
  let sha = '';
  const calls: string[] = [];
  const lock = {
    withLock: async <T>(_id: string, fn: () => Promise<T>) => {
      calls.push('lock:in');
      try {
        return await fn();
      } finally {
        calls.push('lock:out');
      }
    },
  };

  const intel = (over: Partial<RepoIntelReads> & { sha?: string } = {}): RepoIntelReads => ({
    getIndexState: async () => ({ status: 'full', lastIndexedSha: over.sha ?? sha, indexerVersion: 2, updatedAt: new Date('2026-10-11T10:00:00Z') }),
    getTopFilesByRank: async () => ['src/app.ts'],
    getCriticalPaths: async () => [['src/app.ts', 'src/db.ts']],
    getSymbolsInFiles: async () => [{ file: 'src/app.ts', name: 'buildApp', kind: 'function', exported: true }],
    getRepoMap: async () => ({ text: 'map', degraded: false }),
    ...over,
  });
  const repo = (): RepoRecord => ({ id: 'r1', workspaceId: 'w', owner: 'a', name: 'b', fullName: 'a/b', clonePath: dir, createdBy: null });
  const make = (i: RepoIntelReads) =>
    new IndexedEvidenceCapture({ intel: i, index: new RepoIntelIndexReader(i), lock, git: new GitRevisionReader() });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'onb-cap-'));
    git(dir, 'init', '-q');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'README.md'), '# Demo\nRun `pnpm dev`.\n');
    writeFileSync(join(dir, 'package.json'), '{"scripts":{"dev":"tsx"}}');
    writeFileSync(join(dir, '.env'), 'SECRET=hunter2hunter2hunter2\n');
    writeFileSync(join(dir, '.env.example'), 'API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123\nPORT=3000\n');
    writeFileSync(join(dir, 'docs.md'), 'x\n');
    writeFileSync(join(dir, 'KEYS.md'), '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n');
    writeFileSync(join(dir, 'src/app.ts'), 'export const buildApp = () => 1;\n');
    writeFileSync(join(dir, 'src/db.ts'), 'export const db = 1;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
    sha = git(dir, 'rev-parse', 'HEAD');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('captures pinned, screened evidence under the index lock', async () => {
    calls.length = 0;
    const out = await make(intel()).capture(repo());
    expect(out.kind).toBe('captured');
    if (out.kind !== 'captured') return;
    const e = out.evidence;
    expect(e.sourceSha).toBe(sha);
    expect(calls).toEqual(['lock:in', 'lock:out']);
    const paths = e.documents.map((d) => d.path);
    expect(paths).toContain('README.md');
    expect(paths).not.toContain('.env');
    expect(paths).not.toContain('KEYS.md');
    const envExample = e.documents.find((d) => d.path === '.env.example');
    expect(envExample?.text ?? '').not.toContain('sk-');
    expect(JSON.stringify(e.documents)).not.toContain('hunter2');
    expect(e.pathInventory.has('src/app.ts')).toBe(true);
    expect(e.pathInventory.has('.env')).toBe(false);
    expect(e.report.documents_excluded_for_secrets).toBeGreaterThanOrEqual(1);
    expect(e.criticalChains).toEqual([['src/app.ts', 'src/db.ts']]);
  });

  it('reads the indexed commit even after the worktree moves on', async () => {
    writeFileSync(join(dir, 'README.md'), '# CHANGED LATER\n');
    git(dir, 'commit', '-qam', 'later');
    const out = await make(intel()).capture(repo());
    expect(out.kind === 'captured' && out.evidence.documents.find((d) => d.path === 'README.md')?.text).toContain('# Demo');
  });

  it('is unavailable when the index is degraded, empty, or the commit is missing', async () => {
    const degraded = intel({ getIndexState: async () => ({ status: 'full', lastIndexedSha: '', indexerVersion: 1, updatedAt: new Date(), degraded: true }) });
    expect((await make(degraded).capture(repo())).kind).toBe('unavailable');
    expect((await make(intel({ getTopFilesByRank: async () => [] })).capture(repo())).kind).toBe('unavailable');
    expect((await make(intel({ sha: 'f'.repeat(40) })).capture(repo())).kind).toBe('unavailable');
    expect((await make(intel()).capture({ ...repo(), clonePath: null })).kind).toBe('unavailable');
  });
});

describe('IndexedEvidenceCapture path inventory', () => {
  it('keeps ordinary source under build/ or vendor/ citable but never credential files', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'onb-inv-'));
    try {
      git(dir2, 'init', '-q');
      mkdirSync(join(dir2, 'src/build'), { recursive: true });
      mkdirSync(join(dir2, 'server/src/vendor/shared'), { recursive: true });
      writeFileSync(join(dir2, 'src/build/index.ts'), 'export const b = 1;\n');
      writeFileSync(join(dir2, 'server/src/vendor/shared/index.ts'), 'export const s = 1;\n');
      writeFileSync(join(dir2, 'README.md'), '# x\n');
      writeFileSync(join(dir2, '.env'), 'A=1\n');
      writeFileSync(join(dir2, 'server.pem'), 'x\n');
      git(dir2, 'add', '-A');
      git(dir2, 'commit', '-qm', 'i');
      const sha2 = git(dir2, 'rev-parse', 'HEAD');
      const i: RepoIntelReads = {
        getIndexState: async () => ({ status: 'full', lastIndexedSha: sha2, indexerVersion: 1, updatedAt: new Date() }),
        getTopFilesByRank: async () => ['src/build/index.ts', 'server/src/vendor/shared/index.ts'],
        getCriticalPaths: async () => [],
        getSymbolsInFiles: async () => [],
        getRepoMap: async () => ({ text: '', degraded: true }),
      };
      const out = await new IndexedEvidenceCapture({
        intel: i,
        index: new RepoIntelIndexReader(i),
        lock: { withLock: async (_id, fn) => fn() },
        git: new GitRevisionReader(),
      }).capture({ id: 'r', workspaceId: 'w', owner: 'a', name: 'b', fullName: 'a/b', clonePath: dir2, createdBy: null });
      expect(out.kind).toBe('captured');
      if (out.kind !== 'captured') return;
      expect(out.evidence.pathInventory.has('src/build/index.ts')).toBe(true);
      expect(out.evidence.pathInventory.has('server/src/vendor/shared/index.ts')).toBe(true);
      expect(out.evidence.pathInventory.has('.env')).toBe(false);
      expect(out.evidence.pathInventory.has('server.pem')).toBe(false);
      expect(out.evidence.rankedFiles).toHaveLength(2);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
