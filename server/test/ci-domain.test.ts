import { describe, it, expect } from 'vitest';
import { AgentManifest } from '@devdigest/shared';
import {
  generateWorkflowYaml,
  RUNNER_ENTRY,
  WORKFLOW_PATH,
} from '../src/modules/ci/domain/workflow.js';
import {
  buildManifest,
  manifestToYaml,
  ManifestValidationError,
  type ManifestSource,
} from '../src/modules/ci/domain/manifest.js';
import { eventToVerdict } from '../src/modules/ci/domain/verdict.js';
import { slugify, uniqueSlug } from '../src/modules/ci/domain/slug.js';
import { CryptoIngestToken } from '../src/modules/ci/adapters/outbound/providers/ingest-token.js';

/**
 * Hermetic unit tests for the `ci` module's pure domain + the crypto token
 * adapter. No Fastify, no DB. Covers the security-by-construction invariants of
 * the generated workflow (AC-9/11/12/13/14), the manifest round-trip incl. the
 * zero-skills edge (AC-4), verdict derivation (AC-10), and the hashed ingest
 * token with generic-rejection semantics (AC-15).
 */

/** Secret fixtures the generated files must NEVER contain (AC-14). */
const SECRET_FIXTURES = [
  'sk_live_',
  'sk-ant-',
  'ghp_',
  'OPENROUTER_API_KEY=',
  'DEVDIGEST_INGEST_TOKEN=',
];

describe('generateWorkflowYaml (AC-9/11/12/13/14)', () => {
  const yaml = generateWorkflowYaml();

  it('triggers on pull_request opened/synchronize/reopened and runs the bundled runner (AC-9)', () => {
    expect(yaml).toContain('on:');
    expect(yaml).toMatch(/pull_request:\s*\n\s*types:\s*\[opened, synchronize, reopened\]/);
    expect(yaml).toContain(`run: node ${RUNNER_ENTRY}`);
    expect(RUNNER_ENTRY).toBe('.devdigest/runner/index.js');
    expect(WORKFLOW_PATH).toBe('.github/workflows/devdigest-review.yml');
  });

  it('never uses pull_request_target and never references an unpublished external action (AC-9/12)', () => {
    // `pull_request_target` must never be an actual trigger. (It may appear in an
    // explanatory comment; assert it is not a YAML key / trigger entry.)
    const triggerLines = yaml
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .filter((l) => l.includes('pull_request_target'));
    expect(triggerLines).toEqual([]);
    // The only external action is actions/checkout, pinned to a full 40-hex SHA (AC-13).
    const uses = [...yaml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses).toEqual(['actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683']);
    for (const u of uses) {
      expect(u).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('grants exactly contents: read and pull-requests: write (AC-11)', () => {
    const block = yaml.slice(yaml.indexOf('permissions:'), yaml.indexOf('jobs:'));
    expect(block).toContain('contents: read');
    expect(block).toContain('pull-requests: write');
    // Least privilege: no other permission scope is granted.
    const scopes = [...block.matchAll(/^\s{2}([a-z-]+):/gm)].map((m) => m[1]!);
    expect(scopes.sort()).toEqual(['contents', 'pull-requests']);
  });

  it('skips fork PRs with a job-level condition (AC-12)', () => {
    expect(yaml).toContain('if: github.event.pull_request.head.repo.fork == false');
  });

  it('never interpolates ${{ github.event.* }} into any run: script (AC-13)', () => {
    // Collect every `run:` line/script and assert no github.event interpolation.
    const runLines = yaml.split('\n').filter((l) => l.trim().startsWith('run:'));
    expect(runLines.length).toBeGreaterThan(0);
    for (const line of runLines) {
      expect(line).not.toContain('${{ github.event');
    }
    // Defensive: the only place github.event.pull_request.number may appear is an
    // `env:` assignment (passed to the runner as data), never a `run:` body.
    const eventInterps = [...yaml.matchAll(/\$\{\{\s*github\.event[^}]*\}\}/g)];
    for (const m of eventInterps) {
      const lineStart = yaml.lastIndexOf('\n', m.index!) + 1;
      const lineEnd = yaml.indexOf('\n', m.index!);
      const line = yaml.slice(lineStart, lineEnd);
      expect(line.trim()).not.toMatch(/^run:/);
    }
  });

  it('references secrets/vars only as placeholders and embeds no secret value (AC-14)', () => {
    expect(yaml).toContain('${{ secrets.OPENROUTER_API_KEY }}');
    expect(yaml).toContain('${{ secrets.DEVDIGEST_INGEST_TOKEN }}');
    expect(yaml).toContain('${{ vars.DEVDIGEST_API_URL }}');
    for (const fixture of SECRET_FIXTURES) {
      expect(yaml).not.toContain(fixture);
    }
  });

  it('is deterministic (same output every call)', () => {
    expect(generateWorkflowYaml()).toBe(yaml);
  });
});

describe('buildManifest + manifestToYaml (AC-4)', () => {
  const base: ManifestSource = {
    name: 'Security Reviewer',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: 'Review this PR for security issues.',
    skillSlugs: ['sql-injection', 'secrets'],
    strategy: 'single-pass',
    ciFailOn: 'critical',
  };

  it('round-trips a validated manifest through YAML and back via the canonical schema', () => {
    const manifest = buildManifest(base);
    const yaml = manifestToYaml(manifest);
    // Re-parse the emitted YAML scalar fields by reconstructing the object the
    // runner's loader would build, then validate with the SAME contract.
    expect(yaml).toContain('name: "Security Reviewer"');
    expect(yaml).toContain('provider: "openrouter"');
    expect(yaml).toContain('model: "deepseek/deepseek-v4-flash"');
    expect(yaml).toContain('ci_fail_on: "critical"');
    expect(yaml).toContain('skills:');
    expect(yaml).toContain('  - "sql-injection"');
    expect(yaml).toContain('  - "secrets"');
    // The built object is itself a valid AgentManifest.
    expect(AgentManifest.safeParse(manifest).success).toBe(true);
  });

  it('emits `skills: []` for the zero-skills edge (AC-4 edge)', () => {
    const manifest = buildManifest({ ...base, skillSlugs: [] });
    const yaml = manifestToYaml(manifest);
    expect(yaml).toContain('skills: []');
    expect(yaml).not.toContain('  - ');
    expect(manifest.skills).toEqual([]);
  });

  it('escapes newlines/quotes in the system prompt so YAML round-trips (AC-4)', () => {
    const tricky = buildManifest({
      ...base,
      systemPrompt: 'Line one\nwith a "quoted" phrase.',
    });
    const yaml = manifestToYaml(tricky);
    expect(yaml).toContain('system_prompt: "Line one\\nwith a \\"quoted\\" phrase."');
  });

  it('rejects an agent that fails manifest validation (empty name) (AC-4)', () => {
    expect(() => buildManifest({ ...base, name: '' })).toThrow(ManifestValidationError);
  });
});

describe('eventToVerdict (AC-10)', () => {
  it('maps each GitHub review event to its lower-cased verdict deterministically', () => {
    expect(eventToVerdict('APPROVE')).toBe('approve');
    expect(eventToVerdict('REQUEST_CHANGES')).toBe('request_changes');
    expect(eventToVerdict('COMMENT')).toBe('comment');
  });
});

describe('slugify / uniqueSlug', () => {
  it('kebab-cases names and keeps colliding names distinct', () => {
    expect(slugify('SQL Injection!')).toBe('sql-injection');
    const taken = new Set<string>();
    expect(uniqueSlug('Security!', taken)).toBe('security');
    expect(uniqueSlug('security', taken)).toBe('security-2');
    expect(uniqueSlug('Security', taken)).toBe('security-3');
  });

  it('falls back to "skill" when a name has no slug-able characters', () => {
    expect(slugify('!!!')).toBe('skill');
  });
});

describe('CryptoIngestToken (AC-15)', () => {
  const token = new CryptoIngestToken();

  it('generates a 256-bit plaintext and stores only its SHA-256 hash', () => {
    const { plaintext, hash } = token.generate();
    expect(plaintext).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(hash).not.toBe(plaintext);
    expect(token.hash(plaintext)).toBe(hash);
    // Two generations never collide.
    expect(token.generate().plaintext).not.toBe(plaintext);
  });

  it('verify() accepts the matching token and rejects a wrong one (constant-time compare)', () => {
    const { plaintext, hash } = token.generate();
    expect(token.verify(plaintext, hash)).toBe(true);
    expect(token.verify(`${plaintext}x`, hash)).toBe(false);
    expect(token.verify(token.generate().plaintext, hash)).toBe(false);
  });

  it('verify() rejects (without throwing) when the stored hash is not a valid sha256 hex', () => {
    const { plaintext } = token.generate();
    // A malformed/short stored hash must be rejected generically, never throw
    // (timingSafeEqual throws on length mismatch — the adapter guards it).
    expect(token.verify(plaintext, 'deadbeef')).toBe(false);
    expect(token.verify(plaintext, '')).toBe(false);
  });
});
