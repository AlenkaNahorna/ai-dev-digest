import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, uniqueIndex } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable('ci_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
  // SHA-256 hex of the per-installation ingest bearer token (CSPRNG-generated,
  // shown to the member once at export, never stored in plaintext — AC-7).
  tokenHash: text('token_hash'),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
  // Version of the workflow generator the installed files came from (compared
  // with the generator's current version to flag an out-of-date install).
  workflowVersion: integer('workflow_version'),
  // Wizard "Configure" choices of the last export + the PR that carried them.
  postAs: text('post_as', { enum: ['github_review', 'pr_comment', 'none'] }),
  triggers: jsonb('triggers').$type<string[]>(),
  prUrl: text('pr_url'),
});

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    // Deterministic gate outcome (request_changes | approve | comment) — never
    // the model self-report (AC-17).
    verdict: text('verdict'),
    findingsCount: integer('findings_count'),
    critical: integer('critical'),
    warning: integer('warning'),
    suggestion: integer('suggestion'),
    costUsd: doublePrecision('cost_usd'),
    durationMs: integer('duration_ms'),
    // GITHUB_* identifiers used both for the Actions job URL and the dedupe key.
    commitSha: text('commit_sha'),
    runId: text('run_id'),
    runAttempt: integer('run_attempt'),
    githubUrl: text('github_url'),
    source: text('source'),
  },
  (table) => ({
    // Dedupe key (AC-18): one row per (installation, run_id, run_attempt);
    // `onConflictDoNothing` targets this index. Short explicit name (<63 chars)
    // so drizzle-kit does not silently truncate it (server/INSIGHTS.md 2026-10-11).
    runDedupe: uniqueIndex('ci_runs_dedupe_uq').on(
      table.ciInstallationId,
      table.runId,
      table.runAttempt,
    ),
  }),
);
