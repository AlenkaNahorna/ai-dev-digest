import { randomUUID } from 'node:crypto';
import type { Container } from '../../platform/container.js';
import {
  ConventionExtractionOutput,
  type ConventionCandidate,
  type ConventionExtractResult,
  type ConventionSkillDraft,
} from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { RepoRepository } from '../repos/adapters/outbound/persistence/repository.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { ConventionsRepository, type ConventionRow } from './adapters/outbound/persistence/repository.js';
import { buildExtractionMessages, type SampledFile } from './prompt.js';
import { passesEvidenceGate } from './evidence-gate.js';
import { CONFIG_FILE_PATHS, MAX_FILE_CHARS, SAMPLE_FILE_COUNT } from './constants.js';

/**
 * conventions — Conventions Extractor (L02).
 *
 * extract() is the whole pipeline in one call, deliberately synchronous (no
 * SSE/RunLogger like reviews/run-executor.ts): it is a single completeStructured
 * call over ~12 files, not a map-reduce over a diff, so a plain POST that
 * blocks for a few seconds is the simplest correct thing — see the plan doc's
 * "Backend pipeline" section for why this differs from the review run shape.
 *
 *   1. sample   — config files (best-effort) + repoIntel.getConventionSamples
 *   2. analyze  — ONE cheap-model completeStructured call → draft candidates
 *   3. verify   — evidence-gate: drop any candidate whose citation doesn't
 *                 check out against the ACTUAL sampled file content
 *   4. persist  — surviving candidates, pre-accepted, under one new run_id
 */
export class ConventionsService {
  private repos: RepoRepository;
  private conventions: ConventionsRepository;

  constructor(private container: Container) {
    this.repos = new RepoRepository(container.db);
    this.conventions = new ConventionsRepository(container.db);
  }

  private dto(row: ConventionRow): ConventionCandidate {
    return {
      id: row.id,
      repo_id: row.repoId!,
      run_id: row.runId,
      category: row.category as ConventionCandidate['category'],
      rule: row.rule,
      evidence_path: row.evidencePath ?? '',
      evidence_line_start: row.evidenceLineStart ?? 1,
      evidence_line_end: row.evidenceLineEnd ?? row.evidenceLineStart ?? 1,
      evidence_snippet: row.evidenceSnippet ?? '',
      confidence: row.confidence ?? 0,
      accepted: row.accepted,
      created_at: row.createdAt.toISOString(),
    };
  }

  /** GET /repos/:id/conventions — the latest scan's candidates (empty before the first scan). */
  async list(workspaceId: string, repoId: string): Promise<ConventionExtractResult> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const { runId, rows } = await this.conventions.latestRun(workspaceId, repoId);
    return {
      run_id: runId ?? '',
      candidates: rows.map((r) => this.dto(r)),
      sample_files_count: new Set(rows.map((r) => r.evidencePath).filter(Boolean)).size,
      scanned_at: rows[0]?.createdAt.toISOString() ?? new Date(0).toISOString(),
    };
  }

  /** POST /repos/:id/conventions/extract — run the pipeline and persist a new scan. */
  async extract(workspaceId: string, repoId: string): Promise<ConventionExtractResult> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const repoRef = { owner: repo.owner, name: repo.name };

    // 1. sampling — no model involved yet, pure I/O against the local clone.
    const configFiles = await this.readExisting(repoRef, CONFIG_FILE_PATHS);
    const rankedPaths = await this.container.repoIntel.getConventionSamples(
      repoId,
      SAMPLE_FILE_COUNT,
    );
    const sourceFiles = await this.readExisting(repoRef, rankedPaths);
    if (sourceFiles.length === 0) {
      throw new ValidationError(
        'This repo has no indexed source files to sample yet — resync it (or wait for indexing to finish) before extracting conventions.',
      );
    }

    // 2. one structured LLM call over the sampled files.
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(provider);
    const messages = buildExtractionMessages({
      repoFullName: repo.fullName,
      configFiles,
      sourceFiles,
    });
    const result = await llm.completeStructured({
      model,
      schema: ConventionExtractionOutput,
      schemaName: 'convention_extraction',
      messages,
      maxRetries: 2,
      sessionId: `${repo.fullName}:conventions`,
      // Without this, OpenRouter reserves credit for the model's full max
      // output (e.g. 65536 tokens) up front and can 402 a key that can't
      // cover that worst case — even though up to 12 short candidates never
      // gets anywhere near it. ~6K tokens covers 12 candidates comfortably.
      maxTokens: 6000,
    });

    // 3. evidence-gate — verify every citation against what we actually sampled.
    const fileContentByPath = new Map<string, string>(
      [...configFiles, ...sourceFiles].map((f) => [f.path, f.content]),
    );
    // Temporary diagnostic logging — helps tell "model proposed nothing" apart
    // from "model proposed candidates but every citation failed verification"
    // while tuning weaker/cheaper models. Safe to remove once conventions
    // extraction is reliable across the models we support.
    console.error(
      `[conventions] ${model}: model returned ${result.data.candidates.length} draft candidate(s) from ${sourceFiles.length} sample files`,
    );
    for (const c of result.data.candidates) {
      const ok = passesEvidenceGate(c, fileContentByPath);
      console.error(
        `[conventions]   ${ok ? 'KEEP' : 'DROP'} ${c.evidence_path}:${c.evidence_line_start}-${c.evidence_line_end} — "${c.rule.slice(0, 70)}"` +
          (ok ? '' : ` | snippet: ${JSON.stringify(c.evidence_snippet.slice(0, 120))}`),
      );
    }
    const verified = result.data.candidates.filter((c) => passesEvidenceGate(c, fileContentByPath));

    // 4. persist — one run_id groups this scan; every survivor starts UNACCEPTED
    //    so the reviewer has to explicitly Accept each one before it can be
    //    merged into a skill (Reject is just leaving it unaccepted).
    const runId = randomUUID();
    const rows = await this.conventions.insertMany(
      verified.map((c) => ({
        workspaceId,
        repoId,
        runId,
        category: c.category,
        rule: c.rule,
        evidencePath: c.evidence_path,
        evidenceLineStart: c.evidence_line_start,
        evidenceLineEnd: c.evidence_line_end,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
        accepted: false,
      })),
    );

    return {
      run_id: runId,
      candidates: rows.map((r) => this.dto(r)),
      sample_files_count: sourceFiles.length,
      scanned_at: new Date().toISOString(),
    };
  }

  /** PATCH /conventions/:id — Accept/Reject toggle. */
  async setAccepted(workspaceId: string, id: string, accepted: boolean): Promise<ConventionCandidate> {
    const row = await this.conventions.updateAccepted(workspaceId, id, accepted);
    if (!row) throw new NotFoundError('Convention candidate not found');
    return this.dto(row);
  }

  /**
   * POST /repos/:id/conventions/build-skill — merge the given (accepted)
   * candidates into a skill DRAFT (markdown + metadata), NOT yet saved. The
   * client shows this in the "Create skill from conventions" modal, lets the
   * user edit it, then POSTs the edited result to the existing `POST /skills`.
   */
  async buildSkillDraft(
    workspaceId: string,
    repoId: string,
    candidateIds: string[],
  ): Promise<ConventionSkillDraft> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const rows = await this.conventions.getByIds(workspaceId, repoId, candidateIds);
    const accepted = rows.filter((r) => r.accepted);
    if (accepted.length === 0) {
      throw new ValidationError('Select at least one accepted candidate to build a skill from.');
    }

    const name = `${repo.name}-conventions`;
    const lines: string[] = [
      `# ${name}`,
      '',
      `House conventions for \`${repo.fullName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.`,
    ];
    const seenSlugs = new Set<string>();
    for (const item of accepted) {
      const slug = uniqueSlug(item.rule, seenSlugs);
      const start = item.evidenceLineStart ?? 1;
      const end = item.evidenceLineEnd ?? start;
      lines.push(
        '',
        `## ${slug}`,
        item.rule,
        '',
        `Detected in \`${item.evidencePath}:${start}-${end}\`:`,
        '',
        '```',
        (item.evidenceSnippet ?? '').trimEnd(),
        '```',
      );
    }

    return {
      name,
      description: `${accepted.length} house convention${accepted.length === 1 ? '' : 's'} extracted from ${repo.name}`,
      type: 'convention',
      body: lines.join('\n'),
      evidence_files: [...new Set(accepted.map((r) => r.evidencePath).filter((p): p is string => !!p))],
    };
  }

  /** Read a list of repo-relative paths from the local clone; missing files are skipped. */
  private async readExisting(
    repoRef: { owner: string; name: string },
    paths: string[],
  ): Promise<SampledFile[]> {
    const out: SampledFile[] = [];
    for (const path of paths) {
      try {
        const raw = await this.container.git.readFile(repoRef, path);
        out.push({ path, content: raw.slice(0, MAX_FILE_CHARS) });
      } catch {
        // Not every repo has every config file, and a ranked path can point at
        // something the shallow clone doesn't have — skip rather than fail the scan.
      }
    }
    return out;
  }
}

/** kebab-case slug of a rule sentence, deduped against `seen` ("-2", "-3", ...). */
function uniqueSlug(rule: string, seen: Set<string>): string {
  const base =
    rule
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '')
      .slice(0, 40) || 'rule';
  let candidate = base;
  let n = 2;
  while (seen.has(candidate)) candidate = `${base}-${n++}`;
  seen.add(candidate);
  return candidate;
}
