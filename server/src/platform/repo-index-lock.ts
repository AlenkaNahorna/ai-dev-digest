import type { Sql } from 'postgres';
import type { Db } from '../db/client.js';

/**
 * Per-repository index/capture lock.
 *
 * repo-intel's indexers delete-and-rewrite several tables per repository in
 * multiple calls, so any consumer that needs a CONSISTENT read of one indexed
 * revision (onboarding evidence capture) must exclude concurrent index writes
 * for that repository. This port is deliberately feature-agnostic: the indexer
 * and every capture take the same lock, keyed by repository id.
 *
 * Mechanism (Step 0 spike, verified by `test/repo-index-lock.it.test.ts`):
 *  - a SESSION-level `pg_advisory_lock` held on a DEDICATED connection reserved
 *    from the existing postgres-js pool (`sql.reserve()`), so the lock outlives
 *    individual statements and is not tied to a Drizzle transaction;
 *  - acquisition polls `pg_try_advisory_lock` so a wait is BOUNDED
 *    (`LockTimeoutError`) instead of hanging a job slot forever;
 *  - released in `finally`; session locks also vanish when the connection or
 *    process dies, so a crashed holder can never wedge a repository.
 *
 * Failure modes / fallback: session advisory locks do NOT work behind a
 * transaction-pooling proxy (PgBouncer in transaction mode) because consecutive
 * statements may run on different server connections. DevDigest connects to
 * Postgres directly (docker-compose), so this is fine here. If that ever
 * changes, replace this implementation with a lease row + fencing token behind
 * the same `RepoIndexLock` interface; callers do not change.
 */
export interface RepoIndexLock {
  /**
   * Run `fn` while holding the repository's lock. Concurrent callers for the
   * SAME repository are serialized; different repositories never block each
   * other. Rejects with `LockTimeoutError` when the lock cannot be acquired
   * within `timeoutMs`.
   */
  withLock<T>(repoId: string, fn: () => Promise<T>, opts?: { timeoutMs?: number }): Promise<T>;
}

export class LockTimeoutError extends Error {
  readonly code = 'lock_timeout';
  constructor(
    readonly repoId: string,
    readonly waitedMs: number,
  ) {
    super(`Timed out after ${waitedMs}ms waiting for the repository index lock`);
    this.name = 'LockTimeoutError';
  }
}

const LOCK_KEY_PREFIX = 'devdigest:repo-index:';
/** Default wait: indexing itself is capped at ~110s, so a waiter gives up after that. */
export const DEFAULT_LOCK_TIMEOUT_MS = 120_000;
const POLL_MS = 50;

/**
 * drizzle(postgres-js) attaches the underlying client as `$client` at runtime,
 * but the shared `Db` type does not declare it. Narrow access with a clear error
 * (e.g. under `drizzle.mock()`) instead of widening the type app-wide.
 */
function sqlOf(db: Db): Sql {
  const client = (db as unknown as { $client?: Sql }).$client;
  if (!client || typeof client.reserve !== 'function') {
    throw new Error('RepoIndexLock requires a postgres-js backed Db (no reservable client found)');
  }
  return client;
}

export class PgAdvisoryRepoIndexLock implements RepoIndexLock {
  constructor(private readonly db: Db) {}

  async withLock<T>(repoId: string, fn: () => Promise<T>, opts?: { timeoutMs?: number }): Promise<T> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    // Dedicated connection: advisory session locks belong to ONE server session.
    const reserved = await sqlOf(this.db).reserve();
    const key = `${LOCK_KEY_PREFIX}${repoId}`;
    let held = false;
    try {
      const startedAt = Date.now();
      for (;;) {
        // hashtextextended → bigint key; 64-bit space makes collisions negligible.
        const [row] = await reserved<{ locked: boolean }[]>`
          select pg_try_advisory_lock(hashtextextended(${key}, 0)) as locked`;
        if (row?.locked) {
          held = true;
          break;
        }
        const waited = Date.now() - startedAt;
        if (waited >= timeoutMs) throw new LockTimeoutError(repoId, waited);
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      return await fn();
    } finally {
      try {
        if (held) {
          await reserved`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
        }
      } catch {
        // Unlock failed (connection is probably gone, which already dropped the
        // session lock). Fall through to the defensive unlock-all below.
      }
      try {
        // Never hand a connection that might still hold a lock back to the pool.
        await reserved`select pg_advisory_unlock_all()`;
      } catch {
        // Dead connection: Postgres released every session lock with it.
      }
      reserved.release();
    }
  }
}
