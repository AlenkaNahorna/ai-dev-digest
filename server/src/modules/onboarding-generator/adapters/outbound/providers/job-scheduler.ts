import type { JobScheduler } from '../../../application/ports/onboarding-ports.js';

export const ONBOARDING_JOB_KIND = 'onboarding_generate';

interface Jobs {
  enqueue(workspaceId: string, kind: string, payload: unknown): Promise<unknown>;
}

/** Enqueues on the app's JobRunner; the handler is registered by the module plugin. */
export class JobRunnerScheduler implements JobScheduler {
  constructor(private readonly jobs: Jobs) {}
  async enqueue(workspaceId: string, requestId: string): Promise<void> {
    await this.jobs.enqueue(workspaceId, ONBOARDING_JOB_KIND, { requestId });
  }
}
