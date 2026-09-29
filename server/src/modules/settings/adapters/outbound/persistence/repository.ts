import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  list(workspaceId: string) {
    return this.db.select().from(t.settings).where(eq(t.settings.workspaceId, workspaceId));
  }

  async upsert(workspaceId: string, userId: string, values: Record<string, any>) {
    for (const [key, value] of Object.entries(values)) {
      await this.db
        .insert(t.settings)
        .values({ workspaceId, userId, key, value })
        .onConflictDoUpdate({
          target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
          set: { value },
        });
    }
  }
}
