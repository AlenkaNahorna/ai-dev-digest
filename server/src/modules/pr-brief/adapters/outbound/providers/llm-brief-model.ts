import type { Container } from '../../../../../platform/container.js';
import { resolveFeatureModel } from '../../../../settings/feature-models.js';
import { BriefError } from '../../../application/errors.js';
import type { BriefLogPort, BriefModelPort } from '../../../application/ports/brief-ports.js';
import type { BoundedFacts } from '../../../domain/facts.js';
import { BRIEF_SCHEMA_NAME, ModelBriefOutput } from '../../../domain/model-output.js';
import { buildBriefMessages } from './brief-prompt.js';

const MAX_OUTPUT_TOKENS = 2_500;
const TIMEOUT_MS = 90_000;

/**
 * The one model call of a generation (AC-15): provider and model come from the
 * workspace's `risk_brief` feature setting. Any provider failure becomes a safe
 * `BriefError('model_failed')`; provider text is never propagated (A10).
 * The adapter's own repair re-ask (maxRetries: 1) is not counted (spec).
 */
export class LlmBriefModel implements BriefModelPort {
  constructor(
    private readonly container: Container,
    private readonly log?: BriefLogPort,
  ) {}

  async generate(workspaceId: string, pullId: string, facts: BoundedFacts): Promise<ModelBriefOutput> {
    try {
      const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
      this.log?.info('pr-brief: calling model', { pullId, provider, model, missing: facts.missing, partial: facts.partial });
      const llm = await this.container.llm(provider);
      const { system, user } = buildBriefMessages(facts);
      const result = await llm.completeStructured({
        model,
        schema: ModelBriefOutput,
        schemaName: BRIEF_SCHEMA_NAME,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        maxTokens: MAX_OUTPUT_TOKENS,
        timeoutMs: TIMEOUT_MS,
        maxRetries: 1,
        sessionId: `${pullId}:pr-brief`,
      });
      return result.data;
    } catch {
      throw new BriefError('model_failed', 'The brief could not be generated');
    }
  }
}
