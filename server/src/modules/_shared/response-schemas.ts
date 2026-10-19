import { BlastRadius, PrBrief, ContextAttachments, ContextDocBody, ProjectContextList, PrDetail, PrIntentRecord, PrMeta, PrReviewComment, Repo, ReviewRecord, ReviewRunResponse, SmartDiffResponse, MultiAgentRun, MultiAgentEstimate, LatestMultiAgentRun } from '@devdigest/shared';
import { z } from 'zod';

/** Response contracts used by the highest-value public endpoints. */
export const responseSchemas = {
  repos: Repo.array(),
  pulls: PrMeta.array(),
  pull: PrDetail,
  comments: PrReviewComment.array(),
  reviewRun: ReviewRunResponse,
  reviews: ReviewRecord.array(),
  intent: PrIntentRecord.nullable(),
  intentRecord: PrIntentRecord,
  smartDiff: SmartDiffResponse,
  blast: BlastRadius,
  brief: PrBrief.nullable(),
  briefRecord: PrBrief,
  projectContext: ProjectContextList,
  contextDoc: ContextDocBody,
  contextAttachments: ContextAttachments,
  multiAgentRun: MultiAgentRun,
  multiAgentStart: z.object({
    parent_id: z.string(),
    runs: z.array(z.object({ run_id: z.string(), agent_id: z.string(), agent_name: z.string() })),
  }),
  multiAgentEstimate: MultiAgentEstimate,
  latestMultiAgentRun: LatestMultiAgentRun,
};
