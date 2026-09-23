import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { JobRunner } from '../src/platform/jobs.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/**
 * Regression guard: a failing job must never surface as an unhandled promise
 * rejection. Real callers (repos/service.ts's clone/index/refresh enqueues)
 * are fire-and-forget — they never await or .catch() the `done` promise
 * enqueue() returns. Before the fix, a thrown handler error rejected `done`
 * with nothing attached to it, which crashed the whole process.
 */
d('JobRunner (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const [ws] = await pg.handle.db.insert(t.workspaces).values({ name: 'jobs-test' }).returning();
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('a failing job never becomes an unhandled rejection, and records status=failed + error', async () => {
    const runner = new JobRunner(pg.handle.db);
    runner.register('boom', async () => {
      throw new Error('kaboom');
    });

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandledRejection);

    // Mirrors the real fire-and-forget call sites: `done` is intentionally
    // left unawaited/uncaught here.
    const { id } = await runner.enqueue(workspaceId, 'boom', {});
    await runner.onIdle();
    // Let a same-tick unhandled rejection actually surface before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    process.off('unhandledRejection', onUnhandledRejection);
    expect(unhandled).toHaveLength(0);

    const [row] = await pg.handle.db.select().from(t.jobs).where(eq(t.jobs.id, id));
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('kaboom');
  });

  it('a caller that DOES await the returned `done` still observes the rejection', async () => {
    const runner = new JobRunner(pg.handle.db);
    runner.register('boom2', async () => {
      throw new Error('still-throws');
    });

    const { done } = await runner.enqueue(workspaceId, 'boom2', {});
    await expect(done).rejects.toThrow('still-throws');
  });
});
