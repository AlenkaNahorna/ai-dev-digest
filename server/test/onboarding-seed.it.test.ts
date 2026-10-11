import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { DEMO_CONTENT, DEMO_PROVENANCE, DEMO_SHARE_TOKEN } from '../src/db/seed-onboarding-tour.js';
import { OnboardingTourContent, ShareToken, TourProvenance } from '../src/vendor/shared/contracts/onboarding-generator.js';
import { CryptoShareTokens } from '../src/modules/onboarding-generator/adapters/outbound/providers/share-tokens.js';

const hasDb = await dockerAvailable();
const d = hasDb ? describe : describe.skip;

describe('demo tour fixtures', () => {
  it('satisfy the strict contract', () => {
    expect(OnboardingTourContent.safeParse(DEMO_CONTENT).success).toBe(true);
    expect(TourProvenance.safeParse(DEMO_PROVENANCE).success).toBe(true);
    expect(ShareToken.safeParse(DEMO_SHARE_TOKEN).success).toBe(true);
  });
});

d('seed (Postgres)', () => {
  let pg: PgFixture;
  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('seeds one tour + one public snapshot idempotently', async () => {
    await seed(pg.handle.db);
    await seed(pg.handle.db);
    const [repo] = await pg.handle.db.select().from(t.repos).where(eq(t.repos.fullName, 'acme/payments-api'));
    const versions = await pg.handle.db.select().from(t.onboardingTourVersions).where(eq(t.onboardingTourVersions.repoId, repo!.id));
    const shares = await pg.handle.db.select().from(t.onboardingShares).where(eq(t.onboardingShares.repoId, repo!.id));
    expect(versions).toHaveLength(1);
    expect(shares).toHaveLength(1);
    expect(shares[0]!.tokenDigest).toBe(new CryptoShareTokens().digest(DEMO_SHARE_TOKEN));
    const [state] = await pg.handle.db.select().from(t.onboardingRepoState).where(eq(t.onboardingRepoState.repoId, repo!.id));
    expect(state?.latestTourId).toBe(versions[0]!.id);
  });
});
