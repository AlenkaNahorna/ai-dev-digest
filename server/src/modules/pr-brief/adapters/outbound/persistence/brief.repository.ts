import { and, eq } from 'drizzle-orm';
import { PrBrief } from '@devdigest/shared';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';
import type { BriefStorePort } from '../../../application/ports/brief-ports.js';

/** `pr_brief` persistence: one row per PR, every access scoped to the workspace via `pull_requests`. */
export class BriefRepository implements BriefStorePort {
  constructor(private readonly db: Db) {}

  async get(workspaceId: string, pullId: string): Promise<PrBrief | null | undefined> {
    const [pull] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, pullId)));
    if (!pull) return undefined;
    const [row] = await this.db.select({ json: t.prBrief.json }).from(t.prBrief).where(eq(t.prBrief.prId, pullId));
    if (!row) return null;
    // A row that no longer parses is treated as "no brief" so the user can regenerate it.
    const parsed = PrBrief.safeParse(row.json);
    return parsed.success ? parsed.data : null;
  }

  async replace(workspaceId: string, pullId: string, brief: PrBrief): Promise<void> {
    const json = PrBrief.parse(brief);
    const [pull] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, pullId)));
    if (!pull) throw new Error('Pull request not found in workspace');
    // A single upsert statement: the old brief stays until the new one is written.
    await this.db
      .insert(t.prBrief)
      .values({ prId: pullId, json })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json } });
  }
}
