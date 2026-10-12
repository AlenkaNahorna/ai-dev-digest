import { randomUUID } from 'node:crypto';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { createGenerateTour } from './application/use-cases/generate-tour.js';
import { createGenerationLifecycle } from './application/use-cases/generation-lifecycle.js';
import { createRegenerate } from './application/use-cases/regenerate.js';
import { createShareUseCases } from './application/use-cases/shares.js';
import { createGetTourState } from './application/use-cases/tour-state.js';
import type { OnboardingLogger, OnboardingSettings } from './application/ports/onboarding-ports.js';
import { OnboardingRepository } from './adapters/outbound/persistence/repository.js';
import { IndexedEvidenceCapture } from './adapters/outbound/providers/evidence-capture.js';
import { GitRevisionReader } from './adapters/outbound/providers/git-revision-reader.js';
import { RepoIntelIndexReader } from './adapters/outbound/providers/index-reader.js';
import { JobRunnerScheduler, ONBOARDING_JOB_KIND } from './adapters/outbound/providers/job-scheduler.js';
import { LlmTourModel } from './adapters/outbound/providers/llm-tour-model.js';
import { CryptoShareTokens } from './adapters/outbound/providers/share-tokens.js';

/**
 * Composition root of the onboarding-generator module: binds the application
 * ports to concrete adapters. The only place that knows about `Container`.
 */
export function createOnboardingGenerator(container: Container, log: OnboardingLogger) {
  const clock = { now: () => new Date() };
  const settings: OnboardingSettings = {
    publicOrigin: container.config.publicWebOrigin,
    localOrigin: container.config.webOrigin,
    autoGenerate: container.config.onboardingAutoGenerate,
    dailyBudget: container.config.onboardingDailyBudget,
    retainedVersions: container.config.onboardingRetainedVersions,
  };

  const repo = new OnboardingRepository(container.db);
  const index = new RepoIntelIndexReader(container.repoIntel);
  const capture = new IndexedEvidenceCapture({
    intel: container.repoIntel,
    index,
    lock: container.repoIndexLock,
    git: new GitRevisionReader(),
  });
  const model = new LlmTourModel({
    resolve: (workspaceId) => resolveFeatureModel(container, workspaceId, 'onboarding'),
    llm: (provider) => container.llm(provider),
  });
  const tokens = new CryptoShareTokens();
  const generate = createGenerateTour({ model, clock });
  const lifecycle = createGenerationLifecycle({
    repo,
    index,
    capture,
    generate,
    scheduler: new JobRunnerScheduler(container.jobs),
    settings,
    clock,
    log,
    newNonce: () => randomUUID(),
  });

  return {
    settings,
    getState: createGetTourState({ repo, index, settings, clock }),
    regenerate: createRegenerate({ repo, lifecycle }),
    shares: createShareUseCases({ repo, tokens, settings, clock }),
    scheduleAfterIndex: lifecycle.scheduleAfterIndex,
    run: lifecycle.run,
    reconcile: lifecycle.reconcile,

    /** One-shot boot wiring: job handler + index-completion listener + reconciliation. */
    start(): void {
      container.jobs.register(ONBOARDING_JOB_KIND, async (payload) => {
        await lifecycle.run((payload as { requestId: string }).requestId);
      });
      container.onIndexCompleted((repoId) => {
        void lifecycle.scheduleAfterIndex(repoId);
      });
    },
  };
}

export type OnboardingGenerator = ReturnType<typeof createOnboardingGenerator>;
