import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, boolean, vector, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    // Groups every candidate produced by one POST /repos/:id/conventions/extract
    // call, so the UI can show "N of N accepted" per scan and re-scans don't mix.
    runId: uuid('run_id').notNull(),
    category: text('category', {
      enum: ['naming', 'structure', 'testing', 'error-handling', 'api-contract', 'other'],
    })
      .notNull()
      .default('other'),
    rule: text('rule').notNull(),
    evidencePath: text('evidence_path'),
    evidenceLineStart: integer('evidence_line_start'),
    evidenceLineEnd: integer('evidence_line_end'),
    evidenceSnippet: text('evidence_snippet'),
    confidence: doublePrecision('confidence'),
    // Boolean toggle (not a tri-state enum): the extractor pre-accepts every
    // candidate that survives the evidence gate, and Accept/Reject in the UI
    // just flips this back and forth — there is no separate "pending" state.
    accepted: boolean('accepted').notNull().default(false),
    createdAt: now(),
  },
  (t) => ({ repoRunIdx: index('conventions_repo_run_idx').on(t.repoId, t.runId) }),
);
