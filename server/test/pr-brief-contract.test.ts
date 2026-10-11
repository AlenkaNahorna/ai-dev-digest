import { describe, it, expect } from 'vitest';
import { PrBrief } from '@devdigest/shared';
import { responseSchemas } from '../src/modules/_shared/response-schemas.js';

describe('PrBrief contract', () => {
  it('parses a minimal old payload and applies the defaults for the new fields', () => {
    const brief = PrBrief.parse({ summary: 's', risks: { risks: [] } });
    expect(brief.review_focus).toEqual([]);
    expect(brief.missing_inputs).toEqual([]);
    expect(brief.partial).toBe(false);
    expect(brief.intent).toBeUndefined();
    expect(brief.blast).toBeUndefined();
    expect(brief.history).toBeUndefined();
  });

  it('accepts a review focus item without a line, with null, and with a line; rejects a zero line and an unknown missing input', () => {
    const base = { summary: 's', risks: { risks: [] } };
    const parse = (review_focus: unknown, missing_inputs: unknown = []) =>
      PrBrief.safeParse({ ...base, review_focus, missing_inputs }).success;
    expect(parse([{ file: 'a.ts', reason: 'r' }, { file: 'a.ts', line: null, reason: 'r' }, { file: 'a.ts', line: 3, reason: 'r' }])).toBe(true);
    expect(parse([{ file: 'a.ts', line: 0, reason: 'r' }])).toBe(false);
    expect(parse([], ['intent', 'blast', 'findings', 'documents'])).toBe(true);
    expect(parse([], ['nonsense'])).toBe(false);
  });

  it('the GET response schema allows null (no brief yet) and the POST schema does not', () => {
    expect(responseSchemas.brief.safeParse(null).success).toBe(true);
    expect(responseSchemas.briefRecord.safeParse(null).success).toBe(false);
  });
});
