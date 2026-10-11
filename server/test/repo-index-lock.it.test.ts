import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { LockTimeoutError, PgAdvisoryRepoIndexLock } from '../src/platform/repo-index-lock.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Step 0 spike for the onboarding generator: proves the per-repository
 * database-backed lock that the indexer and evidence capture share.
 */
d('PgAdvisoryRepoIndexLock (Postgres)', () => {
  let pg: PgFixture;
  let lock: PgAdvisoryRepoIndexLock;

  beforeAll(async () => {
    pg = await startPg();
    lock = new PgAdvisoryRepoIndexLock(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('serializes overlapping work on the same repository', async () => {
    const events: string[] = [];
    const run = (name: string) =>
      lock.withLock('repo-same', async () => {
        events.push(`${name}:start`);
        await sleep(120);
        events.push(`${name}:end`);
      });
    await Promise.all([run('a'), run('b')]);
    // No interleaving: each holder finishes before the other starts.
    expect(events[0]!.endsWith(':start')).toBe(true);
    expect(events[1]).toBe(events[0]!.replace(':start', ':end'));
    expect(events[2]!.endsWith(':start')).toBe(true);
    expect(events[3]).toBe(events[2]!.replace(':start', ':end'));
  });

  it('does not block different repositories on each other', async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => (releaseA = resolve));
    let aEntered = false;
    const a = lock.withLock('repo-a', async () => {
      aEntered = true;
      await gateA;
    });
    while (!aEntered) await sleep(10);
    // B must complete while A still holds its (different) lock.
    await expect(lock.withLock('repo-b', async () => 'b-done')).resolves.toBe('b-done');
    releaseA();
    await a;
  });

  it('releases the lock when the holder throws', async () => {
    await expect(
      lock.withLock('repo-throws', async () => {
        throw new Error('holder failed');
      }),
    ).rejects.toThrow('holder failed');
    await expect(lock.withLock('repo-throws', async () => 'reacquired', { timeoutMs: 1000 })).resolves.toBe(
      'reacquired',
    );
  });

  it('fails with a bounded timeout instead of hanging when the lock is held', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered = false;
    const holder = lock.withLock('repo-busy', async () => {
      entered = true;
      await gate;
    });
    while (!entered) await sleep(10);
    const started = Date.now();
    await expect(lock.withLock('repo-busy', async () => 'never', { timeoutMs: 300 })).rejects.toBeInstanceOf(
      LockTimeoutError,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    release();
    await holder;
  });

  it('releases the lock when the holding connection dies', async () => {
    // Hold the lock on a raw session, then kill that backend: session-level
    // advisory locks must vanish with the connection (crash safety).
    const sql = pg.handle.sql;
    const holderConn = await sql.reserve();
    const [{ pid }] = await holderConn<{ pid: number }[]>`select pg_backend_pid() as pid`;
    await holderConn`select pg_advisory_lock(hashtextextended('devdigest:repo-index:repo-crash', 0))`;
    await expect(lock.withLock('repo-crash', async () => 'x', { timeoutMs: 200 })).rejects.toBeInstanceOf(
      LockTimeoutError,
    );
    await sql`select pg_terminate_backend(${pid})`;
    await expect(lock.withLock('repo-crash', async () => 'recovered', { timeoutMs: 2000 })).resolves.toBe(
      'recovered',
    );
    try {
      holderConn.release();
    } catch {
      // connection was terminated on purpose
    }
  });
});
