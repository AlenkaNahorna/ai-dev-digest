import { eq } from 'drizzle-orm';
import { db } from '../../../../../db/client.js';
import { tags } from '../../../../../db/schema.js';
import type { TagRepositoryPort, TagRow } from '../../../application/ports/tag-ports.js';

interface TagResponseDto {
  id: string;
  pull_id: string;
  name: string;
}

export function createTagRepository(): TagRepositoryPort {
  return {
    async listForPull(pullId: string): Promise<TagRow[]> {
      return db.select().from(tags).where(eq(tags.pullId, pullId));
    },
    async assign(pullId: string, name: string): Promise<TagResponseDto> {
      const [row] = await db.insert(tags).values({ pullId, name }).returning();
      if (!row) {
        const err = new Error('insert failed') as Error & { statusCode: number };
        err.statusCode = 500;
        throw err;
      }
      return { id: row.id, pull_id: row.pullId, name: row.name };
    },
  };
}
