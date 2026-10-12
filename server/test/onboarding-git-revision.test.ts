import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitRevisionError, GitRevisionReader } from '../src/modules/onboarding-generator/adapters/outbound/providers/git-revision-reader.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();

describe('GitRevisionReader (pinned to a commit)', () => {
  let dir = '';
  let first = '';
  let second = '';
  const reader = new GitRevisionReader();

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'onb-git-'));
    git(dir, 'init', '-q');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'README.md'), '# v1\n');
    writeFileSync(join(dir, 'src/app.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
    writeFileSync(join(dir, 'bad.txt'), Buffer.from([0xff, 0xfe, 0x41]));
    symlinkSync('/etc/passwd', join(dir, 'link'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'one');
    first = git(dir, 'rev-parse', 'HEAD');
    writeFileSync(join(dir, 'README.md'), '# v2 changed\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'two');
    second = git(dir, 'rev-parse', 'HEAD');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the pinned revision, not the live worktree', async () => {
    const v1 = await reader.readBlob(dir, first, 'README.md', 1024);
    const v2 = await reader.readBlob(dir, second, 'README.md', 1024);
    expect(v1).toEqual({ kind: 'text', text: '# v1\n', truncated: false });
    expect(v2.kind === 'text' && v2.text).toBe('# v2 changed\n');
  });

  it('lists blobs only (no symlinks) and reports overflow', async () => {
    const all = await reader.listTree(dir, first, 100);
    const paths = all.entries.map((e) => e.path).sort();
    expect(paths).toContain('src/app.ts');
    expect(paths).not.toContain('link');
    expect(all.overflow).toBe(false);
    const capped = await reader.listTree(dir, first, 1);
    expect(capped.overflow).toBe(true);
    expect(capped.entries).toHaveLength(1);
  });

  it('reports binary, invalid UTF-8 and missing files without throwing', async () => {
    expect((await reader.readBlob(dir, first, 'bin.dat', 1024)).kind).toBe('invalid');
    expect((await reader.readBlob(dir, first, 'bad.txt', 1024)).kind).toBe('invalid');
    expect((await reader.readBlob(dir, first, 'nope.md', 1024)).kind).toBe('missing');
  });

  it('truncates at a byte cap on a code-point boundary', async () => {
    writeFileSync(join(dir, 'u.txt'), 'ééééé');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'u');
    const sha = git(dir, 'rev-parse', 'HEAD');
    const r = await reader.readBlob(dir, sha, 'u.txt', 3);
    expect(r).toEqual({ kind: 'text', text: 'é', truncated: true });
  });

  it('rejects non-full SHAs, unsafe paths and unknown commits safely', async () => {
    await expect(reader.readBlob(dir, 'HEAD', 'README.md', 10)).rejects.toBeInstanceOf(GitRevisionError);
    await expect(reader.readBlob(dir, first, '../x', 10)).rejects.toBeInstanceOf(GitRevisionError);
    expect(await reader.commitExists(dir, 'f'.repeat(40))).toBe(false);
    expect(await reader.commitExists(dir, first)).toBe(true);
  });
});
