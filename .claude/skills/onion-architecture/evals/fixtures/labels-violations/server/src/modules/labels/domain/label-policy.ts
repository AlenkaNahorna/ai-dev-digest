import { eq } from 'drizzle-orm';
import { labels } from '../../../db/schema.js';

const MAX_LABELS_PER_PR = 8;

export function canAttachLabel(existingCount: number): boolean {
  return existingCount < MAX_LABELS_PER_PR;
}

export function normalizeLabelName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

export const labelsTableRef = labels;
export const byId = (id: string) => eq(labels.id, id);
