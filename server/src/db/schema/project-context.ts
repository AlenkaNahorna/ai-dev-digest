import { pgTable, uuid, text, integer, primaryKey, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Project context
//
// Attachments store a repo-relative PATH and an order — never the document text
// (the text is read from the synced clone at run start). Tenancy is inherited:
// the owning agent/skill and the repo are workspace-scoped, and every query
// joins through them. Attaching/detaching does NOT version the agent or skill.

export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
    createdAt: now(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.repoId, t.path] }),
    // Covers the repo_id FK and the "which agents use this doc" lookup.
    repoPathIdx: index('agent_context_docs_repo_path_idx').on(t.repoId, t.path),
  }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
    createdAt: now(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.repoId, t.path] }),
    repoPathIdx: index('skill_context_docs_repo_path_idx').on(t.repoId, t.path),
  }),
);
