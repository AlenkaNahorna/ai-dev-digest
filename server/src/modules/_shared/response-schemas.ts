import { PrDetail, PrMeta, PrReviewComment, Repo, ReviewRecord, ReviewRunResponse } from '@devdigest/shared';

/** Response contracts used by the highest-value public endpoints. */
export const responseSchemas = {
  repos: Repo.array(),
  pulls: PrMeta.array(),
  pull: PrDetail,
  comments: PrReviewComment.array(),
  reviewRun: ReviewRunResponse,
  reviews: ReviewRecord.array(),
};
