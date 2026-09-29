import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the built-in agents (General + Security +
 * Performance, plus the skill-backed Test Quality + API Contract reviewers), all
 * on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- Skill-backed agents: Test Quality Reviewer + API Contract Reviewer ----
  // Each agent is created once (by name) and bound to its own reusable skills
  // through agent_skills, in the given order. Skills are de-duplicated by name.
  type SeedSkill = {
    name: string;
    type: 'rubric' | 'convention' | 'security' | 'custom';
    description: string;
    body: string;
  };
  const seedAgentWithSkills = async (
    agent: Omit<typeof t.agents.$inferInsert, 'workspaceId' | 'provider' | 'model' | 'enabled' | 'version' | 'createdBy'>,
    skillSeeds: SeedSkill[],
  ) => {
    const [existingAgent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agent.name)));
    const [seededAgent] = existingAgent
      ? [existingAgent]
      : await db
          .insert(t.agents)
          .values({
            workspaceId,
            provider: DEFAULT_PROVIDER,
            model: DEFAULT_MODEL,
            enabled: true,
            version: 1,
            createdBy: userId,
            ...agent,
          })
          .returning();
    for (let i = 0; i < skillSeeds.length; i++) {
      const seedSkill = skillSeeds[i]!;
      let [skill] = await db
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, seedSkill.name)));
      if (!skill) {
        [skill] = await db
          .insert(t.skills)
          .values({ workspaceId, ...seedSkill, source: i === 0 ? 'extracted' : 'manual', enabled: true, version: 1 })
          .returning();
        await db.insert(t.skillVersions).values({ skillId: skill!.id, version: 1, body: seedSkill.body });
      }
      await db
        .insert(t.agentSkills)
        .values({ agentId: seededAgent!.id, skillId: skill!.id, order: i, enabled: true })
        .onConflictDoNothing();
    }
  };

  await seedAgentWithSkills(
    {
      name: 'Test Quality Reviewer',
      description: 'Finds missing branches, weak edge-case coverage, over-mocking, and flaky tests.',
      systemPrompt:
        'Review tests for meaningful coverage, correctness, and determinism. Report only actionable findings with exact citations.',
    },
    [
      { name: 'pr-quality-rubric', type: 'rubric', description: 'Evaluate overall pull-request quality and test signal.', body: '# PR Quality Rubric\nEvaluate correctness, security, tests, and scope. Report only actionable findings.' },
      { name: 'test-coverage-gate', type: 'rubric', description: 'Find untested branches and failure paths.', body: '# Test Coverage Gate\nCheck every new branch and failure path. Flag happy-path-only tests when a meaningful branch is uncovered.' },
      { name: 'edge-case-checklist', type: 'convention', description: 'Check boundary, empty, null, and error cases.', body: '# Edge Case Checklist\nCheck empty input, null/undefined, boundaries, concurrency, retries, and malformed input.' },
      { name: 'mocking-and-flake-audit', type: 'custom', description: 'Detect over-mocking, weak assertions, and flaky tests.', body: '# Mocking and Flake Audit\nFlag tests that assert only mocks, over-mock behavior, use timing or randomness, or lack deterministic assertions.' },
    ],
  );

  await seedAgentWithSkills(
    {
      name: 'API Contract Reviewer',
      description: 'Catches breaking changes, schema drift, and inconsistent status codes in the public HTTP contract.',
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
    },
    [
      { name: 'api-breaking-change-rubric', type: 'rubric', description: 'Detect removed, renamed, or retyped fields, routes, and params that break existing clients.', body: '# API Breaking-Change Rubric\nFlag: removed or renamed response fields, routes, methods, or query params; narrowed types; removed enum values; new required request fields; stricter validation on existing inputs; changed success status codes. Adding an optional field or a new route is not breaking. Name the client-visible effect for every finding.' },
      { name: 'http-status-and-error-shape', type: 'convention', description: 'Check status codes and the error body shape stay consistent across routes.', body: '# HTTP Status and Error Shape\nUse 400/422 for invalid input, 401/403 for auth, 404 for a missing or out-of-workspace resource, 409 for conflicts. Never return 200 with an error body. Errors must follow the existing error body shape used by neighbouring routes.' },
      { name: 'schema-first-contract-consistency', type: 'convention', description: 'Keep Zod route schemas, shared contracts, and tests in sync; snake_case wire format.', body: '# Schema-first Contract Consistency\nEvery route validates params, query, body, and response with Zod. Canonical contracts live in server/src/vendor/shared and must change together with the route and its contract test. JSON fields are snake_case; ids end in _id and timestamps in _at; list endpoints reuse the existing pagination shape.' },
      { name: 'api-versioning-and-deprecation', type: 'custom', description: 'Require a version bump or deprecation path for unavoidable breaking changes.', body: '# API Versioning and Deprecation\nA breaking change needs a new version or a deprecation window with a migration path (Deprecation / Sunset headers, changelog entry). Prefer additive changes: keep the old field alongside the new one until clients have moved.' },
    ],
  );

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
