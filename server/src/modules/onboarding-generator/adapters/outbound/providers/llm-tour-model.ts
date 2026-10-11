import type { LLMProvider } from '@devdigest/shared';
import type { ModelResult, TourModel } from '../../../application/ports/onboarding-ports.js';
import { GenerationFailure } from '../../../domain/lifecycle.js';
import { MODEL_OUTPUT_SCHEMA_NAME, ModelTourOutput } from '../../../domain/model-output.js';

/** Resolved by the composition root from workspace Settings (feature id `onboarding`). */
export interface ModelResolver {
  resolve(workspaceId: string): Promise<{ provider: 'openai' | 'anthropic' | 'openrouter'; model: string }>;
  llm(provider: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider>;
}

const MAX_OUTPUT_TOKENS = 6_000;

/** Map a provider failure to a SAFE category — the message/body is never propagated. */
function categorize(err: unknown): GenerationFailure {
  const e = err as { name?: string; code?: string; status?: number; statusCode?: number; message?: string };
  const status = e?.status ?? e?.statusCode;
  if (e?.name === 'ConfigError' || e?.code === 'config_error') return new GenerationFailure('configuration', 'no model/key');
  if (e?.name === 'TimeoutError' || e?.code === 'ETIMEDOUT' || /timed? ?out/i.test(e?.message ?? '')) {
    return new GenerationFailure('timeout', 'provider timeout');
  }
  if (e?.name === 'ZodError' || /schema|parse|json/i.test(e?.message ?? '')) {
    return new GenerationFailure('invalid_output', 'unparseable output');
  }
  if (status === 401 || status === 403) return new GenerationFailure('configuration', `provider ${status}`);
  return new GenerationFailure('provider_failure', typeof status === 'number' ? `provider ${status}` : 'provider error');
}

/**
 * One structured call; the provider's built-in repair retry (maxRetries: 1) is
 * the single format-repair attempt. Raw provider text never leaves this class.
 */
export class LlmTourModel implements TourModel {
  constructor(private readonly resolver: ModelResolver) {}

  async generate(input: Parameters<TourModel['generate']>[0]): Promise<ModelResult> {
    try {
      const { provider, model } = await this.resolver.resolve(input.workspaceId);
      const llm = await this.resolver.llm(provider);
      const result = await llm.completeStructured({
        model,
        schema: ModelTourOutput,
        schemaName: MODEL_OUTPUT_SCHEMA_NAME,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        temperature: 0.2,
        maxTokens: MAX_OUTPUT_TOKENS,
        timeoutMs: input.deadlineMs,
        maxRetries: 1,
        sessionId: `${input.repoFullName}:onboarding`,
      });
      return {
        output: result.data,
        rawBytes: Buffer.byteLength(result.raw ?? '', 'utf8'),
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
      };
    } catch (err) {
      if (err instanceof GenerationFailure) throw err;
      throw categorize(err);
    }
  }
}
