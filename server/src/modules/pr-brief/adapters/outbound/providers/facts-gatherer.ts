import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { Severity } from '@devdigest/shared';
import type { Container } from '../../../../../platform/container.js';
import * as t from '../../../../../db/schema.js';
import { classifyFile } from '../../../../reviews/smart-diff/classify-file.js';
import { latestReviewFindings } from '../../../../reviews/smart-diff/build-smart-diff.js';
import { redactSecrets } from '../../../../reviews/intent/redact.js';
import { createGetBlastRadius } from '../../../../blast/application/use-cases/get-blast-radius.js';
import { BlastRepository } from '../../../../blast/adapters/outbound/persistence/repository.js';
import type { BriefFactsPort, BriefLogPort } from '../../../application/ports/brief-ports.js';
import type { BriefBlastFact, BriefDocument, BriefFacts, BriefFile, BriefFinding, BriefIntentFact } from '../../../domain/facts.js';

/**
 * Reads the precomputed facts of a PR (AC-16). Read-only: no LLM call, no
 * GitHub call, no intent derivation, no indexing (AC-18). Only paths, counts,
 * titles and attached-document text are collected; hunks and patches are
 * dropped here so they cannot reach the prompt (AC-17).
 */
export class FactsGatherer implements BriefFactsPort {
  constructor(
    private readonly container: Container,
    private readonly log?: BriefLogPort,
  ) {}

  async gather(workspaceId: string, pullId: string): Promise<BriefFacts | undefined> {
    const { db } = this.container;
    const [row] = await db
      .select({ pull: t.pullRequests, repo: t.repos })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.pullRequests.repoId, t.repos.id))
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, pullId)));
    if (!row) return undefined;
    const { pull, repo } = row;

    const [files, findings, intent, blast, documents] = await Promise.all([
      this.files(pullId, pull.base, pull.headSha, repo),
      this.findings(workspaceId, pullId),
      this.intent(pullId),
      this.blast(workspaceId, pullId),
      this.documents(workspaceId, { id: repo.id, workspaceId, owner: repo.owner, name: repo.name }),
    ]);

    return {
      title: redactSecrets(pull.title),
      description: redactSecrets(pull.body ?? ''),
      files,
      findings,
      documents,
      intent,
      blast,
    };
  }

  /** Same source as the Intent derivation: git diff base...head, then stored `pr_files` (AC-28). */
  private async files(
    pullId: string,
    base: string,
    headSha: string,
    repo: { owner: string; name: string },
  ): Promise<BriefFile[]> {
    let raw: { path: string; additions: number; deletions: number }[] = [];
    try {
      const diff = await this.container.git.diff({ owner: repo.owner, name: repo.name }, base, headSha);
      raw = diff.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions }));
    } catch {
      /* clone unavailable: fall back to pr_files */
    }
    if (raw.length === 0) {
      raw = await this.container.db
        .select({ path: t.prFiles.path, additions: t.prFiles.additions, deletions: t.prFiles.deletions })
        .from(t.prFiles)
        .where(eq(t.prFiles.prId, pullId));
    }
    const seen = new Set<string>();
    const out: BriefFile[] = [];
    for (const f of raw) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      out.push({ path: f.path, additions: f.additions, deletions: f.deletions, role: classifyFile(f.path) });
    }
    return out;
  }

  /** Newest review per agent, file/line/severity/title only (no bodies, no suggestions). */
  private async findings(workspaceId: string, pullId: string): Promise<BriefFinding[]> {
    const { db } = this.container;
    const reviews = await db
      .select({ id: t.reviews.id, agentId: t.reviews.agentId, createdAt: t.reviews.createdAt })
      .from(t.reviews)
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.prId, pullId)))
      .orderBy(desc(t.reviews.createdAt));
    if (reviews.length === 0) return [];
    const rows = await db
      .select({
        reviewId: t.findings.reviewId,
        file: t.findings.file,
        startLine: t.findings.startLine,
        severity: t.findings.severity,
        title: t.findings.title,
      })
      .from(t.findings)
      .where(
        inArray(
          t.findings.reviewId,
          reviews.map((r) => r.id),
        ),
      );
    const newest = latestReviewFindings(
      reviews.map((r) => ({
        id: r.id,
        agent_id: r.agentId,
        created_at: r.createdAt,
        findings: rows
          .filter((f) => f.reviewId === r.id)
          .flatMap((f) => {
            const severity = Severity.safeParse(f.severity);
            return severity.success
              ? [{ file: f.file, start_line: f.startLine, severity: severity.data, title: redactSecrets(f.title) }]
              : [];
          }),
      })),
    );
    return newest.map((f) => ({ file: f.file, line: f.start_line, severity: f.severity, title: f.title }));
  }

  private async intent(pullId: string): Promise<BriefIntentFact | undefined> {
    const [row] = await this.container.db
      .select({ intent: t.prIntent.intent, inScope: t.prIntent.inScope, outOfScope: t.prIntent.outOfScope })
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, pullId));
    if (!row || row.intent.trim().length === 0) return undefined;
    return {
      summary: redactSecrets(row.intent),
      in_scope: row.inScope.map((s) => redactSecrets(s)),
      out_of_scope: row.outOfScope.map((s) => redactSecrets(s)),
    };
  }

  /** Callers come from `downstream` (never from `summary`); an empty result counts as missing. */
  private async blast(workspaceId: string, pullId: string): Promise<BriefBlastFact | undefined> {
    const container = this.container;
    const getBlastRadius = createGetBlastRadius({
      files: new BlastRepository(container.db),
      intel: { getBlastRadius: (repoId, changedFiles) => container.repoIntel.getBlastRadius(repoId, changedFiles) },
    });
    const result = await getBlastRadius(workspaceId, pullId);
    if (!result) return undefined;
    const callerFiles = [...new Set(result.downstream.flatMap((d) => d.callers.map((c) => c.file)))];
    if (callerFiles.length === 0) return undefined;
    return { summary: result.summary, degraded: result.degraded === true, callerFiles };
  }

  /**
   * Union of the effective documents of every agent of the workspace for this
   * repository, agents in creation order (then id), first occurrence of a path
   * wins (AC-16a). Unusable documents are skipped; only their path is logged (AC-16b).
   */
  private async documents(
    workspaceId: string,
    repo: { id: string; workspaceId: string; owner: string; name: string },
  ): Promise<BriefDocument[]> {
    const agents = await this.container.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(asc(t.agents.createdAt), asc(t.agents.id));
    const byPath = new Map<string, BriefDocument>();
    const warned = new Set<string>();
    for (const agent of agents) {
      const resolved = await this.container.projectContext.resolveForRun(workspaceId, agent.id, repo);
      for (const sk of resolved.skipped) {
        if (warned.has(sk.path)) continue;
        warned.add(sk.path);
        this.log?.warn('pr-brief: skipped document', { path: sk.path, reason: sk.reason });
      }
      for (const d of resolved.docs) {
        if (!byPath.has(d.path)) byPath.set(d.path, { path: d.path, text: redactSecrets(d.text), tokens: d.tokens });
      }
    }
    return [...byPath.values()];
  }
}
