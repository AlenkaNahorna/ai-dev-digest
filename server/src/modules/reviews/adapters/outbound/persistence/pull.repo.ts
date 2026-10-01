import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../../../db/client.js';
import * as t from '../../../../../db/schema.js';
import { IntentConfidence, type Intent } from '@devdigest/shared';
import type { PullRow } from '../../../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

export async function getPrCommits(
  db: Db,
  prId: string,
): Promise<(typeof t.prCommits.$inferSelect)[]> {
  return db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

export type IntentRow = typeof t.prIntent.$inferSelect;

/** Provenance + cost of the classifier call that produced an intent. */
export interface IntentMeta {
  provider: string;
  model: string;
  headSha: string;
  inputHash: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

export async function upsertIntent(
  db: Db,
  prId: string,
  intent: Intent,
  meta: IntentMeta,
): Promise<void> {
  // API field `summary` maps to the pre-existing `intent` column.
  const values = {
    intent: intent.summary,
    inScope: intent.in_scope,
    outOfScope: intent.out_of_scope,
    confidence: intent.confidence,
    sources: intent.sources,
    missingContext: intent.missing_context,
    provider: meta.provider,
    model: meta.model,
    headSha: meta.headSha,
    inputHash: meta.inputHash,
    tokensIn: meta.tokensIn,
    tokensOut: meta.tokensOut,
    costUsd: meta.costUsd,
    updatedAt: new Date(),
  };
  await db
    .insert(t.prIntent)
    .values({ prId, ...values })
    .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
}

export async function getIntentRow(db: Db, prId: string): Promise<IntentRow | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  return row;
}

export function rowToIntent(row: IntentRow): Intent {
  return {
    summary: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: IntentConfidence.catch('medium').parse(row.confidence),
    sources: row.sources as Intent['sources'],
    missing_context: row.missingContext,
  };
}
