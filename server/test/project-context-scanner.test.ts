import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';
import { CloneDocScanner } from '../src/modules/project-context/adapters/outbound/providers/clone-scanner.js';

const REPO = { id: 'r1', workspaceId: 'w1', owner: 'acme', name: 'app' };
const ROOTS = ['specs', 'docs', 'insights'];

describe('CloneDocScanner (tmpdir clone)', () => {
  let base: string;
  let clone: string;
  let outside: string;
  let scanner: CloneDocScanner;

  const put = async (rel: string, text = '# doc\n') => {
    await mkdir(join(clone, rel, '..'), { recursive: true });
    await writeFile(join(clone, rel), text);
  };

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'pc-scan-'));
    clone = join(base, 'acme', 'app');
    outside = await mkdtemp(join(tmpdir(), 'pc-outside-'));
    await mkdir(clone, { recursive: true });
    scanner = new CloneDocScanner(() => new SimpleGitClient(base));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('lists .md files under the roots at any depth, sorted, with size and mtime', async () => {
    await put('specs/a.md', 'hello');
    await put('server/docs/arch.md');
    await put('insights/deep/er/i.md');
    await put('src/code.md'); // not under a root
    await put('docs/notes.txt'); // not markdown
    const docs = await scanner.scan(REPO, ROOTS);
    expect(docs.map((d) => d.path)).toEqual(['insights/deep/er/i.md', 'server/docs/arch.md', 'specs/a.md']);
    expect(docs.find((d) => d.path === 'specs/a.md')?.size).toBe(5);
    expect(Number.isNaN(Date.parse(docs[0]!.updatedAt))).toBe(false);
  });

  it('skips excluded directories', async () => {
    await put('docs/ok.md');
    await put('node_modules/pkg/docs/x.md');
    await put('docs/vendor/y.md');
    await put('.pnpm-store/docs/z.md');
    expect((await scanner.scan(REPO, ROOTS)).map((d) => d.path)).toEqual(['docs/ok.md']);
  });

  it('tolerates missing roots and a missing clone', async () => {
    await put('specs/only.md');
    expect((await scanner.scan(REPO, ['specs', 'does-not-exist'])).map((d) => d.path)).toEqual(['specs/only.md']);
    expect(await scanner.scan({ ...REPO, name: 'no-clone' }, ROOTS)).toEqual([]);
  });

  it('never lists or reads through symlinks that escape the clone (AC-4)', async () => {
    await writeFile(join(outside, 'secret.md'), 'TOP SECRET');
    await mkdir(join(outside, 'dir'), { recursive: true });
    await writeFile(join(outside, 'dir', 'inner.md'), 'inner');
    await mkdir(join(clone, 'docs'), { recursive: true });
    await symlink(join(outside, 'secret.md'), join(clone, 'docs', 'link.md'));
    await symlink(join(outside, 'dir'), join(clone, 'docs', 'linkdir'));
    await put('docs/real.md');
    expect((await scanner.scan(REPO, ROOTS)).map((d) => d.path)).toEqual(['docs/real.md']);
    // The reader is an independent guard: even when asked directly it must not escape.
    await expect(scanner.read(REPO, 'docs/link.md')).rejects.toThrow();
    await expect(scanner.read(REPO, '../../outside.md')).rejects.toThrow();
  });
});
