import { AgentManifest } from '@devdigest/shared';
import type { CiFailOn, Provider } from '@devdigest/shared';

/**
 * Serialize an agent to the canonical `AgentManifest` YAML written to
 * `.devdigest/agents/<slug>.yaml` and read back by the agent-runner. Pure
 * (domain layer): no Fastify/Drizzle/filesystem. The input is VALIDATED against
 * the same `AgentManifest` Zod schema the runner parses with, so an invalid
 * agent config is rejected at export time (AC-4) rather than failing in CI.
 */

export interface ManifestSource {
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  /** Skill slugs (already resolved by the caller), in order. */
  skillSlugs: string[];
  strategy: 'auto' | 'single-pass' | 'map-reduce';
  ciFailOn: CiFailOn;
}

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

/** Double-quote + escape a scalar so YAML round-trips any string safely. */
function yamlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** Validate + build the `AgentManifest` object (throws on invalid). */
export function buildManifest(source: ManifestSource): AgentManifest {
  const candidate = {
    name: source.name,
    provider: source.provider,
    model: source.model,
    system_prompt: source.systemPrompt,
    skills: source.skillSlugs,
    strategy: source.strategy,
    ci_fail_on: source.ciFailOn,
  };
  const parsed = AgentManifest.safeParse(candidate);
  if (!parsed.success) {
    throw new ManifestValidationError(
      `Agent cannot be exported — manifest validation failed: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

/** Deterministic YAML text for a validated manifest. */
export function manifestToYaml(manifest: AgentManifest): string {
  const lines: string[] = [
    `name: ${yamlString(manifest.name)}`,
    `provider: ${yamlString(manifest.provider)}`,
    `model: ${yamlString(manifest.model)}`,
    `system_prompt: ${yamlString(manifest.system_prompt)}`,
    `strategy: ${yamlString(manifest.strategy)}`,
    `ci_fail_on: ${yamlString(manifest.ci_fail_on)}`,
  ];
  if (manifest.skills.length === 0) {
    lines.push('skills: []');
  } else {
    lines.push('skills:');
    for (const slug of manifest.skills) {
      lines.push(`  - ${yamlString(slug)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
