import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';

describe('SimpleGitClient.readFile containment', () => {
  let base: string;
  const repo = { owner: 'acme', name: 'api' };
  const other = { owner: 'acme', name: 'other' };
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'dd-git-'));
    await mkdir(join(base, 'acme/api/docs'), { recursive: true });
    await mkdir(join(base, 'acme/other/docs'), { recursive: true });
    await writeFile(join(base, 'acme/api/docs/plan.md'), 'PLAN');
    await writeFile(join(base, 'acme/other/docs/secret.md'), 'OTHER-SECRET');
    await symlink(join(base, 'acme/other/docs/secret.md'), join(base, 'acme/api/docs/link.md'));
  });
  afterAll(() => rm(base, { recursive: true, force: true }));

  it('reads files inside the clone', async () => {
    expect(await new SimpleGitClient(base).readFile(repo, 'docs/plan.md')).toBe('PLAN');
  });
  it('rejects traversal into a sibling clone', async () => {
    await expect(new SimpleGitClient(base).readFile(repo, 'docs/../../other/docs/secret.md')).rejects.toThrow(/escapes/);
    expect(other.name).toBe('other');
  });
  it('rejects symlinks that point outside the clone', async () => {
    await expect(new SimpleGitClient(base).readFile(repo, 'docs/link.md')).rejects.toThrow(/escapes/);
  });
});
