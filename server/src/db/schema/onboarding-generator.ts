import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces, users } from './core';
import { repos } from './repos';

// ============================================================ Onboarding generator
//
// New feature-owned tables. The legacy `onboarding` table (repo_id/json/
// generated_at) is deliberately left untouched: its JSON was never validated
// against source provenance, so it is not treated as a successful tour.
//
// Tenancy: every row carries workspace_id; private reads/writes always join
// through the repo, and only the share snapshot read is anonymous (by token
// digest, never by id).

/** Immutable successful tour versions. Never updated after insert. */
export const onboardingTourVersions = pgTable(
  'onboarding_tour_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Validated `OnboardingTourContent`. */
    content: jsonb('content').notNull(),
    /** Validated `TourProvenance` (source sha, index metadata, evidence report, degraded sections). */
    provenance: jsonb('provenance').notNull(),
    sourceSha: text('source_sha').notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull(),
    indexerVersion: integer('indexer_version').notNull(),
    indexStatus: text('index_status').notNull(),
    model: text('model'),
    createdAt: now(),
  },
  (t) => ({
    // Covers the repo_id FK and "latest N versions of a repo" (retention pruning, listing).
    repoCreatedIdx: index('onboarding_tour_versions_repo_created_idx').on(t.repoId, t.createdAt),
    wsIdx: index('onboarding_tour_versions_ws_idx').on(t.workspaceId),
  }),
);

/**
 * Durable generation requests. `status` lifecycle:
 *   queued → running → succeeded | failed ; queued|running → superseded.
 * `attempt_token` + `lease_expires_at` fence every worker write: only the
 * current attempt holder can publish, and only while its lease is valid.
 */
export const onboardingGenerationRequests = pgTable(
  'onboarding_generation_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull(),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('queued'),
    /** Index identity at request time — drives automatic de-duplication. */
    identityKey: text('identity_key').notNull(),
    attemptToken: uuid('attempt_token'),
    attemptCount: integer('attempt_count').notNull().default(0),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    /** Safe category only; raw provider text/stacks are never persisted here. */
    errorCategory: text('error_category'),
    tourId: uuid('tour_id'),
    model: text('model'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /** Estimated spend (price-book); nullable — an audit field, not a billing system. */
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    createdAt: now(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    // Covers the repo_id FK, the per-repo daily budget count and "latest request".
    repoCreatedIdx: index('onboarding_generation_requests_repo_created_idx').on(t.repoId, t.createdAt),
    wsIdx: index('onboarding_generation_requests_ws_idx').on(t.workspaceId),
    // Boot reconciliation scans non-terminal requests.
    activeIdx: index('onboarding_generation_requests_active_idx')
      .on(t.status, t.leaseExpiresAt)
      .where(sql`${t.status} in ('queued', 'running')`),
    // Automatic generation is de-duplicated per index identity (sha + indexer version + completeness).
    autoIdentityUq: uniqueIndex('onboarding_generation_requests_auto_identity_uq')
      .on(t.repoId, t.identityKey)
      .where(sql`${t.trigger} = 'automatic'`),
    tourIdx: index('onboarding_generation_requests_tour_idx').on(t.tourId),
    // Explicit short name: the generated one exceeds Postgres' 63-char identifier limit.
    tourFk: foreignKey({
      name: 'onboarding_requests_tour_fk',
      columns: [t.tourId],
      foreignColumns: [onboardingTourVersions.id],
    }).onDelete('set null'),
  }),
);

/**
 * Per-repository pointers, kept SEPARATE from request status so a failed or
 * pending regeneration never touches the last successful tour (AC-9).
 */
export const onboardingRepoState = pgTable(
  'onboarding_repo_state',
  {
    repoId: uuid('repo_id')
      .primaryKey()
      .references(() => repos.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    latestTourId: uuid('latest_tour_id'),
    currentRequestId: uuid('current_request_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    wsIdx: index('onboarding_repo_state_ws_idx').on(t.workspaceId),
    latestIdx: index('onboarding_repo_state_latest_idx').on(t.latestTourId),
    currentIdx: index('onboarding_repo_state_current_idx').on(t.currentRequestId),
    // Explicit short names: generated ones exceed Postgres' 63-char identifier limit.
    latestFk: foreignKey({
      name: 'onboarding_state_latest_tour_fk',
      columns: [t.latestTourId],
      foreignColumns: [onboardingTourVersions.id],
    }).onDelete('set null'),
    currentFk: foreignKey({
      name: 'onboarding_state_current_request_fk',
      columns: [t.currentRequestId],
      foreignColumns: [onboardingGenerationRequests.id],
    }).onDelete('set null'),
  }),
);

/**
 * Independent public snapshots: a full COPY of the displayed tour's content and
 * provenance, so later regeneration or retention pruning never changes a share.
 * Only a SHA-256 digest of the token is stored; the raw token is shown once.
 */
export const onboardingShares = pgTable(
  'onboarding_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Source version (kept by retention while any share references it). */
    tourId: uuid('tour_id').references(() => onboardingTourVersions.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    tokenDigest: text('token_digest').notNull(),
    content: jsonb('content').notNull(),
    provenance: jsonb('provenance').notNull(),
    repoFullName: text('repo_full_name').notNull(),
    createdAt: now(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    tokenUq: uniqueIndex('onboarding_shares_token_digest_uq').on(t.tokenDigest),
    repoIdx: index('onboarding_shares_repo_idx').on(t.repoId, t.createdAt),
    wsIdx: index('onboarding_shares_ws_idx').on(t.workspaceId),
    tourIdx: index('onboarding_shares_tour_idx').on(t.tourId),
    creatorIdx: index('onboarding_shares_creator_idx').on(t.createdBy),
  }),
);
