import { spawn } from 'node:child_process';
import { isSafeRelativePath } from '@devdigest/shared/contracts/onboarding-generator.js';

/**
 * Revision-pinned, read-only Git access for evidence capture.
 *
 * Why not `GitClient.readFile`: it reads the LIVE worktree and substitutes invalid
 * UTF-8, so it cannot prove a document belongs to the captured revision. Every
 * read here names a full commit hash, so a later clone reset can never change
 * what a tour was generated from (and a missing commit fails safely — it is
 * never replaced by the current HEAD).
 *
 * Why spawn instead of simple-git `raw()`: output must be BOUNDED while it
 * streams (huge trees, huge blobs); simple-git buffers everything first. Git is
 * always invoked with an argument array (no shell), a minimal environment and a
 * hard timeout.
 */
const FULL_SHA = /^[0-9a-f]{40}$/;
const DEFAULT_TIMEOUT_MS = 20_000;
/** Absolute ceiling for any single git output we are willing to hold in memory. */
const MAX_TREE_BYTES = 24 * 1024 * 1024;

export interface TreeEntry {
  path: string;
  size: number;
}

export type BlobRead =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'invalid' }
  | { kind: 'missing' };

interface RunResult {
  stdout: Buffer;
  /** True when output was cut at `maxBytes` (the process is killed). */
  capped: boolean;
  code: number | null;
}

function minimalEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: 'C.UTF-8',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

export class GitRevisionError extends Error {
  constructor(
    readonly reason: 'invalid_input' | 'commit_missing' | 'git_failed' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'GitRevisionError';
  }
}

export class GitRevisionReader {
  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  private run(cwd: string, args: string[], maxBytes: number): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['-C', cwd, ...args], { env: minimalEnv(), stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks: Buffer[] = [];
      let size = 0;
      let capped = false;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new GitRevisionError('timeout', 'git timed out'));
      }, this.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        if (capped) return;
        if (size + chunk.length > maxBytes) {
          chunks.push(chunk.subarray(0, maxBytes - size));
          size = maxBytes;
          capped = true;
          child.kill('SIGKILL');
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new GitRevisionError('git_failed', err.message));
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout: Buffer.concat(chunks), capped, code });
      });
    });
  }

  private assertSha(sha: string): void {
    if (!FULL_SHA.test(sha)) throw new GitRevisionError('invalid_input', 'not a full commit hash');
  }

  /** True when the pinned commit object is reachable in this clone. */
  async commitExists(clonePath: string, sha: string): Promise<boolean> {
    this.assertSha(sha);
    const res = await this.run(clonePath, ['cat-file', '-e', `${sha}^{commit}`], 16);
    return res.code === 0;
  }

  /**
   * Blob entries of the commit's tree (symlinks, submodules and unsafe paths are
   * dropped). `overflow` is true when the listing exceeded `maxEntries`/bytes, in
   * which case `entries` is a bounded prefix and the caller must fall back.
   */
  async listTree(
    clonePath: string,
    sha: string,
    maxEntries: number,
  ): Promise<{ entries: TreeEntry[]; overflow: boolean }> {
    this.assertSha(sha);
    const res = await this.run(clonePath, ['ls-tree', '-r', '-l', '-z', '--full-tree', sha], MAX_TREE_BYTES);
    if (res.code !== 0 && !res.capped) throw new GitRevisionError('commit_missing', 'cannot list the pinned revision');
    return this.parseTree(res.stdout, maxEntries, res.capped);
  }

  /** Non-recursive listing of specific paths (fallback when the full inventory is too large). */
  async listPaths(
    clonePath: string,
    sha: string,
    paths: string[],
    maxEntries: number,
  ): Promise<{ entries: TreeEntry[]; overflow: boolean }> {
    this.assertSha(sha);
    const safe = paths.filter((p) => isSafeRelativePath(p) && !p.startsWith('-'));
    const args = ['ls-tree', '-l', '-z', '--full-tree', sha];
    if (safe.length > 0) args.push('--', ...safe.slice(0, 200));
    const res = await this.run(clonePath, args, 4 * 1024 * 1024);
    if (res.code !== 0 && !res.capped) return { entries: [], overflow: false };
    return this.parseTree(res.stdout, maxEntries, res.capped);
  }

  private parseTree(buf: Buffer, maxEntries: number, capped: boolean): { entries: TreeEntry[]; overflow: boolean } {
    const entries: TreeEntry[] = [];
    let overflow = capped;
    const records = buf.toString('utf8').split('\0');
    // When capped, the last record may be truncated mid-line: drop it.
    if (capped) records.pop();
    for (const rec of records) {
      if (rec === '') continue;
      // "<mode> <type> <object> <size>\t<path>"
      const m = /^(\d{6}) (\w+) ([0-9a-f]{40,64}) +(-|\d+)\t([\s\S]+)$/.exec(rec);
      if (!m) continue;
      const [, mode, type, , size, path] = m;
      if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) continue; // no symlinks/submodules
      if (!isSafeRelativePath(path!)) continue;
      if (entries.length >= maxEntries) {
        overflow = true;
        break;
      }
      entries.push({ path: path!, size: size === '-' ? 0 : Number(size) });
    }
    return { entries, overflow };
  }

  /**
   * Read at most `maxBytes` of a blob at the pinned commit. Never follows the
   * worktree; invalid UTF-8 / NUL bytes are reported as `invalid`.
   */
  async readBlob(clonePath: string, sha: string, path: string, maxBytes: number): Promise<BlobRead> {
    this.assertSha(sha);
    if (!isSafeRelativePath(path)) throw new GitRevisionError('invalid_input', 'unsafe path');
    const res = await this.run(clonePath, ['cat-file', 'blob', `${sha}:${path}`], maxBytes + 1);
    if (res.code !== 0 && !res.capped) return { kind: 'missing' };
    let bytes = res.stdout;
    let truncated = false;
    if (bytes.length > maxBytes) {
      truncated = true;
      let end = maxBytes;
      // Do not split a UTF-8 code point (continuation bytes are 10xxxxxx).
      while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
      bytes = bytes.subarray(0, end);
    }
    if (bytes.includes(0)) return { kind: 'invalid' };
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { kind: 'text', text, truncated };
    } catch {
      return { kind: 'invalid' };
    }
  }
}
