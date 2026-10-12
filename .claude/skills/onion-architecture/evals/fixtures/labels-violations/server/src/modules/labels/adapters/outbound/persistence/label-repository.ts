import { eq } from 'drizzle-orm';
import { db } from '../../../../../db/client.js';
import { labels } from '../../../../../db/schema.js';
import type { LabelRepositoryPort, LabelRow } from '../../../application/ports/label-ports.js';

export function createLabelRepository(): LabelRepositoryPort {
  return {
    async listForRepo(repoId: string): Promise<LabelRow[]> {
      return db.select().from(labels).where(eq(labels.repoId, repoId));
    },
    async create(repoId: string, name: string, color: string): Promise<LabelRow> {
      const [row] = await db.insert(labels).values({ repoId, name, color }).returning();
      return row;
    },
  };
}
