import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';
import type { OnboardingTourContent, TourProvenance } from '../vendor/shared/contracts/onboarding-generator.js';

/**
 * Feature-owned demo data for the Onboarding Tour (deterministic e2e + local demo).
 * Seeds one already-successful tour version for the demo repo, the repo's latest-success
 * pointer, and ONE public snapshot with a FIXED demo token so browser flows can open the
 * public route without a model call.
 *
 * DEMO ONLY: the token below is a published constant. It only ever grants read access to
 * this fictional demo tour in seeded databases; real shares always use random tokens.
 */
export const DEMO_SHARE_TOKEN = 'ddDemoOnboardingSnapshotTokenForE2eOnly0001';

export const DEMO_SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

export const DEMO_PROVENANCE: TourProvenance = {
  source_sha: DEMO_SOURCE_SHA,
  indexed_at: '2026-10-11T09:00:00.000Z',
  indexer_version: 1,
  index_status: 'full',
  generated_at: '2026-10-11T09:05:00.000Z',
  evidence: {
    documents_used: 2,
    documents_skipped: 0,
    excerpts_used: 0,
    ranked_files: 3,
    critical_chains: 1,
    symbols: 3,
    documents_excluded_for_secrets: 0,
    lines_redacted: 0,
    truncated: false,
    notes: [],
  },
  degraded_sections: ['first_tasks'],
};

export const DEMO_CONTENT: OnboardingTourContent = {
  sections: [
    {
      key: 'architecture',
      status: 'available',
      summary:
        'Demo payments API: a **Fastify** HTTP layer delegates to a service layer that persists to **PostgreSQL**. This is seeded demo content, not generated from a real model call.',
      diagram: {
        nodes: [
          { id: 'api', label: 'HTTP API', kind: 'service', path: 'src/app.ts' },
          { id: 'payments', label: 'Payments service', kind: 'module', path: 'src/payments/service.ts' },
          { id: 'db', label: 'PostgreSQL', kind: 'datastore', path: null },
        ],
        edges: [
          { from: 'api', to: 'payments', label: 'calls' },
          { from: 'payments', to: 'db', label: 'queries' },
        ],
      },
      diagram_note: null,
    },
    {
      key: 'critical_paths',
      status: 'available',
      entries: [
        { path: 'src/app.ts', role: 'Builds the HTTP application and registers routes.' },
        { path: 'src/payments/service.ts', role: 'Core payment processing logic.' },
      ],
    },
    {
      key: 'local_run',
      status: 'available',
      steps: [
        { order: 1, instruction: 'Install dependencies', command: 'pnpm install', source: 'package.json' },
        { order: 2, instruction: 'Start the development server', command: 'pnpm dev', source: 'README.md' },
      ],
    },
    {
      key: 'reading_path',
      status: 'available',
      entries: [
        { order: 1, path: 'README.md', reason: 'Project overview and setup.' },
        { order: 2, path: 'src/app.ts', reason: 'Entry point wiring everything together.' },
        { order: 3, path: 'src/payments/service.ts', reason: 'Where the business rules live.' },
      ],
    },
    {
      key: 'first_tasks',
      status: 'unavailable',
      reason: 'The seeded demo has no code evidence to suggest grounded first tasks.',
    },
  ],
};

export function demoTokenDigest(): string {
  return createHash('sha256').update(DEMO_SHARE_TOKEN, 'utf8').digest('hex');
}

/** Idempotent: does nothing when the repo already has any onboarding tour version. */
export async function seedOnboardingTour(
  db: Db,
  input: { workspaceId: string; repoId: string; repoFullName: string; userId: string },
): Promise<void> {
  const [existing] = await db
    .select({ id: t.onboardingTourVersions.id })
    .from(t.onboardingTourVersions)
    .where(eq(t.onboardingTourVersions.repoId, input.repoId))
    .limit(1);
  if (existing) return;

  const [version] = await db
    .insert(t.onboardingTourVersions)
    .values({
      repoId: input.repoId,
      workspaceId: input.workspaceId,
      content: DEMO_CONTENT,
      provenance: DEMO_PROVENANCE,
      sourceSha: DEMO_SOURCE_SHA,
      indexedAt: new Date(DEMO_PROVENANCE.indexed_at),
      indexerVersion: DEMO_PROVENANCE.indexer_version,
      indexStatus: DEMO_PROVENANCE.index_status,
      model: 'seed',
    })
    .returning({ id: t.onboardingTourVersions.id });

  await db
    .insert(t.onboardingRepoState)
    .values({ repoId: input.repoId, workspaceId: input.workspaceId, latestTourId: version!.id })
    .onConflictDoUpdate({ target: t.onboardingRepoState.repoId, set: { latestTourId: version!.id } });

  const [share] = await db
    .select({ id: t.onboardingShares.id })
    .from(t.onboardingShares)
    .where(and(eq(t.onboardingShares.repoId, input.repoId), eq(t.onboardingShares.tokenDigest, demoTokenDigest())))
    .limit(1);
  if (!share) {
    await db.insert(t.onboardingShares).values({
      repoId: input.repoId,
      workspaceId: input.workspaceId,
      tourId: version!.id,
      createdBy: input.userId,
      tokenDigest: demoTokenDigest(),
      content: DEMO_CONTENT,
      provenance: DEMO_PROVENANCE,
      repoFullName: input.repoFullName,
    });
  }
}
