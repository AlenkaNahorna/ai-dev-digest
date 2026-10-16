import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, doublePrecision, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  inputDiff: text('input_diff'),
  inputFiles: jsonb('input_files'),
  inputMeta: jsonb('input_meta'),
  expectedOutput: jsonb('expected_output'),
  notes: text('notes'),
  /** L06: the decided finding this case was born from (one case per owner + finding). */
  sourceFindingId: uuid('source_finding_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    ownerIdx: index('eval_cases_owner_idx').on(t.ownerKind, t.ownerId),
    sourceFindingUq: uniqueIndex('eval_cases_owner_finding_uq').on(t.ownerId, t.sourceFindingId),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => evalCases.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  actualOutput: jsonb('actual_output'),
  pass: boolean('pass'),
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  durationMs: integer('duration_ms'),
  costUsd: doublePrecision('cost_usd'),
  /** L06: all rows of one "Run all evals" press share a batch id. */
  batchId: uuid('batch_id'),
  agentVersion: integer('agent_version'),
  provider: text('provider'),
  model: text('model'),
  },
  (t) => ({
    batchIdx: index('eval_runs_batch_idx').on(t.batchId),
    caseIdx: index('eval_runs_case_idx').on(t.caseId, t.ranAt),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
