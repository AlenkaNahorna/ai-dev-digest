import { eq } from 'drizzle-orm';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';

export class WorkspaceRepository {
  constructor(private readonly db: Db) {}

  listRepos(workspaceId: string) {
    return this.db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
  }
}
