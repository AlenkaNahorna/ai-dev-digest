import { describe, it, expect, vi } from 'vitest';
import { ContextAttachmentsInput } from '@devdigest/shared';
import { createListContext } from '../src/modules/project-context/application/use-cases/list-context.js';
import { createGetAttachments, createPutAttachments } from '../src/modules/project-context/application/use-cases/attachments.js';
import { createResolveForRun } from '../src/modules/project-context/application/use-cases/resolve-for-run.js';
import { createCountUsage } from '../src/modules/project-context/application/use-cases/count-usage.js';
import { ProjectContextError } from '../src/modules/project-context/application/errors.js';
import type {
  AttachmentsRepo,
  DocReader,
  DocScanner,
  EffectiveInputs,
  RepoInfo,
  ReposPort,
} from '../src/modules/project-context/application/ports/project-context-ports.js';
import type { AttachedDoc } from '../src/modules/project-context/domain/effective-set.js';

const REPO: RepoInfo = { id: '11111111-1111-4111-8111-111111111111', workspaceId: 'ws1', owner: 'acme', name: 'app' };
const REPOS: ReposPort = { findById: async (id) => (id === REPO.id ? REPO : undefined) };
const SETTINGS = { roots: ['specs', 'docs', 'insights'], warnTokens: 100_000 };
const tokenizer = { count: (t: string) => Math.ceil(t.length / 4) };

function scannerOf(files: Record<string, string>): DocScanner & DocReader {
  return {
    scan: async () => Object.entries(files).map(([path, text]) => ({ path, size: text.length, updatedAt: '2026-01-01T00:00:00.000Z' })),
    read: async (_r, path) => {
      if (!(path in files)) throw new Error('ENOENT');
      return files[path]!;
    },
  };
}

function attachmentsOf(init: { agent?: AttachedDoc[]; inputs?: EffectiveInputs; owners?: string[] } = {}) {
  let agentDocs = init.agent ?? [];
  const replaceDocs = vi.fn(async (_k: string, _o: string, _r: string, docs: AttachedDoc[]) => {
    agentDocs = docs;
  });
  const repo: AttachmentsRepo = {
    ownerInWorkspace: async (_k, _ws, id) => (init.owners ?? ['a1']).includes(id),
    getDocs: async () => agentDocs,
    replaceDocs,
    effectiveInputs: async () => init.inputs ?? { agentDocs: [], skills: [] },
  };
  return { repo, replaceDocs };
}

describe('listContext', () => {
  it('returns typed, sized, sorted docs with tokens_total and used_by_agents', async () => {
    const io = scannerOf({ 'specs/b.md': 'bbbb', 'docs/a.md': 'aaaaaaaa' });
    const list = createListContext({
      repos: REPOS,
      scanner: io,
      reader: io,
      countUsage: async () => new Map([['specs/b.md', 2]]),
      tokenizer,
      settings: SETTINGS,
      now: () => new Date('2026-02-02T00:00:00.000Z'),
    });
    const out = await list('ws1', REPO.id);
    expect(out.files.map((f) => f.path)).toEqual(['docs/a.md', 'specs/b.md']);
    expect(out.files[0]).toMatchObject({ type: 'docs', tokens: 2, size: 8, used_by_agents: 0 });
    expect(out.files[1]).toMatchObject({ type: 'specs', tokens: 1, used_by_agents: 2 });
    expect(out.tokens_total).toBe(3);
    expect(out.warn_tokens).toBe(100_000);
    expect(out.roots).toEqual(['specs', 'docs', 'insights']);
    expect(out.index).toEqual({ files: 2, indexed_at: '2026-02-02T00:00:00.000Z' });
  });

  it('refuses a repo outside the caller workspace with "forbidden" and reads nothing (AC-45)', async () => {
    const io = scannerOf({ 'docs/a.md': 'x' });
    const scan = vi.spyOn(io, 'scan');
    const list = createListContext({ repos: REPOS, scanner: io, reader: io, countUsage: async () => new Map(), tokenizer, settings: SETTINGS });
    await expect(list('other-ws', REPO.id)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(list('ws1', '22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({ kind: 'forbidden' });
    expect(scan).not.toHaveBeenCalled();
  });

  it('lists an unreadable doc with null tokens instead of failing', async () => {
    const io = scannerOf({ 'docs/a.md': 'x' });
    const list = createListContext({
      repos: REPOS,
      scanner: io,
      reader: { read: async () => { throw new Error('boom'); } },
      countUsage: async () => new Map(),
      tokenizer,
      settings: SETTINGS,
    });
    const out = await list('ws1', REPO.id);
    expect(out.files[0]!.tokens).toBeNull();
    expect(out.tokens_total).toBe(0);
  });
});

describe('attachments', () => {
  const io = scannerOf({ 'specs/a.md': 'a', 'docs/b.md': 'b' });

  it('flags attached paths that are no longer discovered as missing (AC-20)', async () => {
    const { repo } = attachmentsOf({ agent: [{ path: 'specs/gone.md', order: 1 }, { path: 'specs/a.md', order: 0 }] });
    const get = createGetAttachments({ repos: REPOS, scanner: io, attachments: repo, settings: SETTINGS });
    const out = await get('agent', 'ws1', 'a1', REPO.id);
    expect(out.docs).toEqual([
      { path: 'specs/a.md', order: 0, missing: false },
      { path: 'specs/gone.md', order: 1, missing: true },
    ]);
  });

  it('replaces the set with discovered paths and returns it (AC-15, AC-47)', async () => {
    const { repo, replaceDocs } = attachmentsOf();
    const put = createPutAttachments({ repos: REPOS, scanner: io, attachments: repo, settings: SETTINGS });
    const out = await put('agent', 'ws1', 'a1', { repo_id: REPO.id, docs: [{ path: 'docs/b.md', order: 0 }, { path: 'specs/a.md', order: 1 }] });
    expect(replaceDocs).toHaveBeenCalledWith('agent', 'a1', REPO.id, [{ path: 'docs/b.md', order: 0 }, { path: 'specs/a.md', order: 1 }]);
    expect(out.docs.map((d) => d.path)).toEqual(['docs/b.md', 'specs/a.md']);
  });

  it('rejects the whole request when a NEW path is not a discovered document (AC-46)', async () => {
    const { repo, replaceDocs } = attachmentsOf();
    const put = createPutAttachments({ repos: REPOS, scanner: io, attachments: repo, settings: SETTINGS });
    const err = await put('agent', 'ws1', 'a1', { repo_id: REPO.id, docs: [{ path: 'specs/a.md', order: 0 }, { path: 'docs/evil.md', order: 1 }] }).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectContextError);
    expect(err.kind).toBe('invalid');
    expect(replaceDocs).not.toHaveBeenCalled();
  });

  it('lets an already-attached but now-missing path stay while editing the rest', async () => {
    const { repo, replaceDocs } = attachmentsOf({ agent: [{ path: 'specs/gone.md', order: 0 }] });
    const put = createPutAttachments({ repos: REPOS, scanner: io, attachments: repo, settings: SETTINGS });
    await put('agent', 'ws1', 'a1', { repo_id: REPO.id, docs: [{ path: 'specs/gone.md', order: 0 }, { path: 'specs/a.md', order: 1 }] });
    expect(replaceDocs).toHaveBeenCalledTimes(1);
  });

  it('404s for an agent/skill outside the workspace and 403s for a foreign repo', async () => {
    const { repo } = attachmentsOf({ owners: [] });
    const put = createPutAttachments({ repos: REPOS, scanner: io, attachments: repo, settings: SETTINGS });
    await expect(put('agent', 'ws1', 'a1', { repo_id: REPO.id, docs: [] })).rejects.toMatchObject({ kind: 'not_found' });
    await expect(put('skill', 'other', 'a1', { repo_id: REPO.id, docs: [] })).rejects.toMatchObject({ kind: 'forbidden' });
  });
});

describe('PUT body schema (AC-46)', () => {
  const repo_id = REPO.id;
  const parse = (docs: unknown) => ContextAttachmentsInput.safeParse({ repo_id, docs });

  it('accepts a clean set', () => {
    expect(parse([{ path: 'specs/a.md', order: 0 }, { path: 'docs/Ü 日本.md', order: 1 }]).success).toBe(true);
  });
  it('rejects duplicate paths and duplicate order values', () => {
    expect(parse([{ path: 'specs/a.md', order: 0 }, { path: 'specs/a.md', order: 1 }]).success).toBe(false);
    expect(parse([{ path: 'specs/a.md', order: 0 }, { path: 'specs/b.md', order: 0 }]).success).toBe(false);
  });
  it('rejects traversal, absolute, backslash and non-.md paths', () => {
    for (const path of ['../secret.md', 'specs/../../x.md', '/etc/passwd.md', 'C:/x.md', 'specs\\a.md', 'specs/a.txt', 'specs//a.md', '']) {
      expect(parse([{ path, order: 0 }]).success, path).toBe(false);
    }
  });
});

describe('resolveForRun (AC-23, AC-34, AC-36, AC-38)', () => {
  it('reads effective docs once in order, dedupes, and skips unusable ones by path', async () => {
    const files: Record<string, string> = {
      'specs/a.md': 'AAAA',
      'specs/empty.md': '  \n',
      'specs/bin.md': 'bad \uFFFD',
      'docs/s.md': 'SSSSSSSS',
    };
    const read = vi.fn(async (_r: RepoInfo, p: string) => {
      if (!(p in files)) throw new Error('gone');
      return files[p]!;
    });
    const { repo } = attachmentsOf({
      inputs: {
        agentDocs: [{ path: 'specs/a.md', order: 0 }, { path: 'specs/empty.md', order: 1 }, { path: 'specs/bin.md', order: 2 }, { path: 'specs/deleted.md', order: 3 }],
        skills: [{ skillOrder: 0, docs: [{ path: 'specs/a.md', order: 0 }, { path: 'docs/s.md', order: 1 }, { path: 'src/evil.md', order: 2 }] }],
      },
    });
    const resolve = createResolveForRun({ attachments: repo, reader: { read }, tokenizer, settings: SETTINGS });
    const out = await resolve('ws1', 'a1', REPO);
    expect(out.docs).toEqual([
      { path: 'specs/a.md', text: 'AAAA', tokens: 1 },
      { path: 'docs/s.md', text: 'SSSSSSSS', tokens: 2 },
    ]);
    expect(out.skipped).toEqual([
      { path: 'specs/empty.md', reason: 'empty' },
      { path: 'specs/bin.md', reason: 'non_utf8' },
      { path: 'specs/deleted.md', reason: 'unreadable' },
      { path: 'src/evil.md', reason: 'outside_roots' },
    ]);
    // single snapshot: each path read at most once; out-of-root path never read
    expect(read.mock.calls.map((c) => c[1])).toEqual(['specs/a.md', 'specs/empty.md', 'specs/bin.md', 'specs/deleted.md', 'docs/s.md']);
  });

  it('returns nothing for an agent without attachments', async () => {
    const { repo } = attachmentsOf();
    const resolve = createResolveForRun({ attachments: repo, reader: { read: async () => 'x' }, tokenizer, settings: SETTINGS });
    expect(await resolve('ws1', 'a1', REPO)).toEqual({ docs: [], skipped: [] });
  });
});

describe('countUsage', () => {
  it('counts distinct agents over direct and skill rows', async () => {
    const count = createCountUsage({
      usage: {
        listUsage: async () => ({
          direct: [{ agentId: 'a1', path: 'specs/a.md' }],
          viaSkills: [{ agentId: 'a1', path: 'specs/a.md' }, { agentId: 'a2', path: 'specs/a.md' }],
        }),
      },
    });
    expect((await count('ws1', REPO.id)).get('specs/a.md')).toBe(2);
  });
});
