import type {
  Intent,
  IntentCallTrace,
  IntentClassification,
  PrIntentRecord,
  UnifiedDiff,
} from '@devdigest/shared';
import { IntentClassification as IntentClassificationSchema } from '@devdigest/shared';
import { createHash } from 'node:crypto';
import { buildIntentPrompt, finalizeIntent } from '@devdigest/reviewer-core';
import type { Container } from '../../../platform/container.js';
import { logPrompt } from '../../../platform/prompt-log.js';
import type { RunLogger } from '../../../platform/run-logger.js';
import { NotFoundError } from '../../../platform/errors.js';
import { withTimeout } from '../../../platform/resilience.js';
import * as schema from '../../../db/schema.js';
import { resolveFeatureModel } from '../../settings/feature-models.js';
import type { PullRow, ReviewRepository } from '../adapters/outbound/persistence/repository.js';
import { rowToIntent } from '../adapters/outbound/persistence/pull.repo.js';
import { loadDiff } from '../diff-loader.js';
import { gatherSources } from './sources.js';
import { redactSecrets } from './redact.js';

/**
 * Hard cap on the classifier call. Intent is a pre-step of every review, so a
 * slow/hung provider must not stall the review itself (the caller treats a
 * timeout like any other intent failure and reviews without it).
 */
export const INTENT_TIMEOUT_MS = 20_000;

/**
 * Cache key part covering the PR's editable text. Together with head_sha it decides
 * whether a persisted intent is still valid — editing only the title/description
 * (no new commit) must not keep serving an intent derived from the old text.
 */
export function intentInputHash(pull: { title: string; body: string | null }): string {
  return createHash('sha256').update(`${pull.title}\n\0${pull.body ?? ''}`).digest('hex').slice(0, 16);
}

export interface EnsureIntentResult {
  intent: Intent;
  call: IntentCallTrace;
}

/**
 * Intent layer service. Owns the SEPARATE, cheap-model classifier call that turns
 * PR title/description/linked material/file list (+ hunk headers, never change
 * bodies) into a structured Intent, and its persistence per PR.
 *
 * The classifier call is logged apart from the main review call: model, prompt
 * component sizes, token estimate and source identifiers — no prompt text, no
 * diff bodies, no secrets.
 */
export class IntentService {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    /** Resolves the classifier model (Settings → review_intent); injectable for tests. */
    private resolveModel: typeof resolveFeatureModel = resolveFeatureModel,
  ) {}

  /** The persisted intent for a PR (with `stale` vs the current head), or null. */
  async get(workspaceId: string, prId: string): Promise<PrIntentRecord | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const row = await this.repo.getIntentRow(prId);
    if (!row) return null;
    return {
      ...rowToIntent(row),
      pr_id: prId,
      stale: row.headSha !== pull.headSha || row.inputHash !== intentInputHash(pull),
      provider: row.provider,
      model: row.model,
      head_sha: row.headSha,
      updated_at: row.updatedAt?.toISOString() ?? null,
    };
  }

  /** User-triggered re-derivation (PR updated). Always calls the classifier. */
  async rederive(workspaceId: string, prId: string, log: RunLogger): Promise<PrIntentRecord> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repoRow);
    await this.ensure({ workspaceId, pull, repoRow, diff, log, force: true });
    const rec = await this.get(workspaceId, prId);
    if (!rec) throw new NotFoundError('Intent not found');
    return rec;
  }

  /**
   * Return the intent for the PR's current head: the persisted one when it was
   * derived for this head_sha (no LLM call), otherwise classify + persist.
   * Throws on failure — callers in the review path treat that as non-fatal.
   */
  async ensure(args: {
    workspaceId: string;
    pull: PullRow;
    repoRow: typeof schema.repos.$inferSelect;
    diff: UnifiedDiff;
    log: RunLogger;
    force?: boolean;
  }): Promise<EnsureIntentResult> {
    const { workspaceId, pull, repoRow, diff, log } = args;
    const choice = await this.resolveModel(this.container, workspaceId, 'review_intent');

    const existing = await this.repo.getIntentRow(pull.id);
    if (!args.force && existing && existing.headSha === pull.headSha && existing.inputHash === intentInputHash(pull)) {
      const intent = rowToIntent(existing);
      log.info(
        `[intent] reused persisted intent for ${pull.headSha.slice(0, 7)} (${existing.provider ?? '?'}/${existing.model ?? '?'}); no classifier call`,
      );
      return {
        intent,
        call: {
          provider: existing.provider ?? choice.provider,
          model: existing.model ?? choice.model,
          cached: true,
          components: {},
          tokens_est: 0,
          tokens_in: existing.tokensIn ?? 0,
          tokens_out: existing.tokensOut ?? 0,
          cost_usd: existing.costUsd ?? null,
          duration_ms: 0,
          confidence: intent.confidence,
          sources: intent.sources,
        },
      };
    }

    const repoRef = { owner: repoRow.owner, name: repoRow.name };
    const started = Date.now();
    const prFiles = await this.repo.getPrFiles(pull.id);
    const commits = await this.repo.getPrCommits(pull.id);

    const gathered = await log.step(
      '[intent] Gathering intent sources (issue / plan / spec links)',
      () =>
        gatherSources({
          getIssue: async (n) => (await this.container.github()).getIssue(repoRef, n),
          readFile: (path) => this.container.git.readFile(repoRef, path),
          repo: repoRef,
          headSha: pull.headSha,
          title: pull.title,
          description: pull.body,
          prFiles: prFiles.map((f) => ({ path: f.path, patch: f.patch })),
        }),
      { kind: 'tool' },
    );

    const prompt = buildIntentPrompt({
      title: redactSecrets(pull.title),
      description: pull.body ? redactSecrets(pull.body) : null,
      issues: gathered.issues,
      docs: gathered.docs,
      unresolved: gathered.unresolved,
      files: diff.files,
      commits: commits.map((c) => redactSecrets(c.message)),
    });
    const tokensEst = prompt.messages.reduce((n, m) => n + this.container.tokenizer.count(m.content), 0);

    // Observability: section names, sources, sizes, model, correlation id.
    // NO prompt text / diff bodies / plan-spec content (see platform/prompt-log.ts).
    logPrompt(
      log,
      {
        correlationId: log.correlationId,
        call: 'intent',
        provider: choice.provider,
        model: choice.model,
        prId: pull.id,
      },
      prompt.sections,
      this.container.tokenizer,
      this.container.config.promptLogVerbose,
    );
    log.info(`[intent] sources: ${prompt.sources.map((s) => `${s.kind}:${s.resolved ? 'ok' : 'MISSING'}`).join(', ')}`, {
      sources: prompt.sources.map((s) => ({ kind: s.kind, ref: s.ref, resolved: s.resolved })),
    });

    const llm = await this.container.llm(choice.provider);
    const res = await log.step(
      `[intent] Classifying PR intent (${choice.model})`,
      () =>
        withTimeout(
          llm.completeStructured<IntentClassification>({
            model: choice.model,
            schema: IntentClassificationSchema,
            schemaName: 'IntentClassification',
            messages: prompt.messages,
            temperature: 0,
            maxRetries: 2,
            timeoutMs: INTENT_TIMEOUT_MS,
            sessionId: `${repoRow.owner}/${repoRow.name}#${pull.number}:intent`,
          }),
          INTENT_TIMEOUT_MS,
        ),
      { kind: 'tool' },
    );

    const intent = finalizeIntent(res.data, prompt.sources);
    await this.repo.upsertIntent(pull.id, intent, {
      provider: choice.provider,
      model: choice.model,
      headSha: pull.headSha,
      inputHash: intentInputHash(pull),
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      costUsd: res.costUsd,
    });

    const durationMs = Date.now() - started;
    log.result(
      `[intent] done: confidence=${intent.confidence}, ${intent.in_scope.length} in / ${intent.out_of_scope.length} out of scope, ` +
        `${intent.missing_context.length} missing-context note(s); tokens ${res.tokensIn}→${res.tokensOut}`,
    );
    return {
      intent,
      call: {
        provider: choice.provider,
        model: choice.model,
        cached: false,
        components: prompt.components,
        tokens_est: tokensEst,
        tokens_in: res.tokensIn,
        tokens_out: res.tokensOut,
        cost_usd: res.costUsd,
        duration_ms: durationMs,
        confidence: intent.confidence,
        sources: prompt.sources,
      },
    };
  }
}
