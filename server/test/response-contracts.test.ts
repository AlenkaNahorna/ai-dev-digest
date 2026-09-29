import { describe, expect, it } from 'vitest';
import { ApiErrorBody, PrMeta, ReviewRunResponse } from '../src/vendor/shared/index.js';

describe('HTTP response contracts', () => {
  it('keeps key response schemas parseable by the shared contract source', () => {
    expect(ApiErrorBody.parse({ error: { code: 'internal_error', message: 'Internal error' } }).error.code).toBe('internal_error');
    expect(PrMeta.array().parse([])).toEqual([]);
    expect(ReviewRunResponse.safeParse({ pr_id: 'not-a-response' }).success).toBe(false);
  });
});
