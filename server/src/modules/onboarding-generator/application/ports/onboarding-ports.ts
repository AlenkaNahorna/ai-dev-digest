import type {
  GenerationErrorCategory,
  OnboardingTourContent,
  TourProvenance,
} from '@devdigest/shared/contracts/onboarding-generator.js';
import type { CapturedEvidence } from '../../domain/evidence.js';
import type { ModelTourOutput } from '../../domain/model-output.js';
import type { RequestStatus, RequestTrigger } from '../../domain/lifecycle.js';

/**
 * Narrow ports the use cases depend on. The application layer knows nothing
 * about Drizzle, Fastify, simple-git, the LLM SDKs or the DI container; the
 * composition root (`../../index.ts`) binds these to concrete adapters.
 */

export interface RepoRecord {
  id: string;
  workspaceId: string;
  owner: string;
  name: string;
  fullName: string;
  /** Local clone directory (null until cloned). */
  clonePath: string | null;
  /** The repository's owner for this version: `repos.created_by` (null for legacy rows). */
  createdBy: string | null;
}

/** The current usable index of a repository, or null when there is no usable evidence (AC-3). */
export interface CurrentIndex {
  sourceSha: string;
  indexedAt: Date;
  indexerVersion: number;
  indexStatus: 'full' | 'partial';
}

export interface IndexReader {
  /** Cheap read of repo-intel state + a probe for real evidence. Never calls an LLM. */
  currentUsableIndex(repoId: string): Promise<CurrentIndex | null>;
}

export interface StoredTour {
  id: string;
  repoId: string;
  content: OnboardingTourContent;
  provenance: TourProvenance;
  createdAt: Date;
}

export interface RequestRecord {
  id: string;
  repoId: string;
  workspaceId: string;
  trigger: RequestTrigger;
  status: RequestStatus;
  identityKey: string;
  attemptToken: string | null;
  errorCategory: GenerationErrorCategory | null;
  tourId: string | null;
  createdAt: Date;
}

export interface RepoStateRecord {
  latestTour: StoredTour | null;
  currentRequest: RequestRecord | null;
}

export type CreateRequestOutcome =
  | { kind: 'created'; request: RequestRecord }
  | { kind: 'duplicate' }
  | { kind: 'budget_reached' };

export interface PublishSuccessInput {
  requestId: string;
  attemptToken: string;
  now: Date;
  content: OnboardingTourContent;
  provenance: TourProvenance;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  /** Keep the newest N versions per repository (plus any version a share references). */
  retainVersions: number;
}

export interface PublishFailureInput {
  requestId: string;
  attemptToken: string;
  now: Date;
  category: GenerationErrorCategory;
}

export interface ShareRecord {
  id: string;
  repoId: string;
  tourId: string | null;
  sourceSha: string;
  createdBy: string;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface PublicSnapshotRecord {
  repoFullName: string;
  content: OnboardingTourContent;
  provenance: TourProvenance;
  sharedAt: Date;
}

export type RevokeOutcome =
  | { kind: 'revoked'; revokedAt: Date }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

export interface TourRepository {
  /** Workspace-scoped repository lookup: null when absent OR owned by another workspace. */
  getRepo(workspaceId: string, repoId: string): Promise<RepoRecord | null>;
  /** Unscoped lookup for server-side workers/hooks that carry only a repo id. */
  getRepoById(repoId: string): Promise<RepoRecord | null>;
  getState(repoId: string): Promise<RepoStateRecord>;

  /**
   * One transaction: lock the repo's state row, apply the daily budget and the
   * automatic de-duplication, mark any active current request `superseded`,
   * insert the new request and point the repo at it.
   */
  createRequest(input: {
    repo: RepoRecord;
    trigger: RequestTrigger;
    requestedBy: string | null;
    identityKey: string;
    dailyBudget: number;
    windowStart: Date;
  }): Promise<CreateRequestOutcome>;
  getRequest(requestId: string): Promise<RequestRecord | null>;
  /** Requests (any trigger/status) created since `since` — the per-repository daily budget count. */
  countRequestsSince(repoId: string, since: Date): Promise<number>;

  /**
   * Compare-and-set claim: only a CURRENT, queued request can be claimed. Returns
   * the new attempt token (fencing) or null when it was superseded/taken.
   */
  claim(requestId: string, now: Date, leaseMs: number): Promise<{ attemptToken: string } | null>;
  /**
   * Fenced publication in ONE transaction: insert the immutable version, mark the
   * request succeeded and move the repo's latest-success pointer — all conditioned
   * on the request still being current, running, owned by `attemptToken` and
   * inside its lease. Returns null (and changes nothing) otherwise.
   */
  publishSuccess(input: PublishSuccessInput): Promise<{ tourId: string } | null>;
  /** Fenced failure write; never touches the latest-success pointer. */
  publishFailure(input: PublishFailureInput): Promise<boolean>;

  /** Boot reconciliation: requeue current requests whose lease expired; supersede stale ones. Returns requeued ids. */
  reclaimExpired(now: Date): Promise<string[]>;
  /** Current requests still waiting to run (enqueue gap / restart recovery). */
  listQueuedCurrent(): Promise<RequestRecord[]>;

  // ---- shares
  getTour(repoId: string, tourId: string): Promise<StoredTour | null>;
  /** Copy the version's content/provenance into an independent snapshot, atomically. Null if the version is not this repo's. */
  createShare(input: {
    repo: RepoRecord;
    tourId: string;
    createdBy: string;
    tokenDigest: string;
  }): Promise<ShareRecord | null>;
  listShares(repoId: string): Promise<ShareRecord[]>;
  revokeShare(input: { repoId: string; shareId: string; userId: string; now: Date }): Promise<RevokeOutcome>;
  /** Active (not revoked) snapshot by token digest. */
  getSnapshotByDigest(digest: string): Promise<PublicSnapshotRecord | null>;
}

export type CaptureOutcome =
  | { kind: 'captured'; evidence: CapturedEvidence }
  | { kind: 'unavailable'; reason: string };

export interface EvidenceCapture {
  /**
   * Capture bounded, revision-consistent evidence for the repository's current
   * usable index. Holds the per-repository index lock while reading index state
   * and materialized facts; Git reads are pinned to the captured SHA.
   */
  capture(repo: RepoRecord): Promise<CaptureOutcome>;
}

export interface ModelResult {
  output: ModelTourOutput;
  /** Raw model text (size-checked by the caller; never persisted). */
  rawBytes: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

export interface TourModel {
  /**
   * One structured call (with the provider's single format-repair attempt).
   * Throws `GenerationFailure` carrying a SAFE category; never raw provider text.
   */
  generate(input: {
    workspaceId: string;
    repoFullName: string;
    system: string;
    user: string;
    deadlineMs: number;
  }): Promise<ModelResult>;
}

export interface JobScheduler {
  /** Fire-and-forget enqueue; resolves once the job is registered, not when it finishes. */
  enqueue(workspaceId: string, requestId: string): Promise<void>;
}

export interface ShareTokens {
  create(): { token: string; digest: string };
  digest(token: string): string;
}

export interface OnboardingSettings {
  /** Absolute https origin for share links, or null (links are then local-only). */
  publicOrigin: string | null;
  localOrigin: string;
  autoGenerate: boolean;
  dailyBudget: number;
  retainedVersions: number;
}

export interface OnboardingLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface Clock {
  now(): Date;
}
