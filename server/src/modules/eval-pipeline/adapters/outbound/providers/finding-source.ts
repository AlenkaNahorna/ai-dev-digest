import { and, desc, eq, or, isNotNull } from 'drizzle-orm';
import type { Container } from '../../../../../platform/container.js';
import * as t from '../../../../../db/schema.js';
import { loadDiff } from '../../../../reviews/diff-loader.js';
import type { FindingSourcePort, SourceFinding } from '../../../application/ports/eval-ports.js';

type Joined = {
  finding: typeof t.findings.$inferSelect;
  review: typeof t.reviews.$inferSelect;
};

function toSource(row: Joined): SourceFinding {
  const { finding, review } = row;
  return {
    id: finding.id,
    prId: review.prId,
    agentId: review.agentId,
    file: finding.file,
    startLine: finding.startLine,
    endLine: finding.endLine,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    decision: finding.acceptedAt ? 'accepted' : finding.dismissedAt ? 'dismissed' : null,
  };
}

/** Reads decided findings (workspace-scoped through their review) and the PR diff. */
export class FindingSource implements FindingSourcePort {
  constructor(private container: Container) {}

  async getFinding(workspaceId: string, findingId: string): Promise<SourceFinding | undefined> {
    const [row] = await this.container.db
      .select({ finding: t.findings, review: t.reviews })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(and(eq(t.findings.id, findingId), eq(t.reviews.workspaceId, workspaceId)));
    return row ? toSource(row) : undefined;
  }

  async listDecided(workspaceId: string, agentId: string): Promise<SourceFinding[]> {
    const rows = await this.container.db
      .select({ finding: t.findings, review: t.reviews })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          eq(t.reviews.agentId, agentId),
          or(isNotNull(t.findings.acceptedAt), isNotNull(t.findings.dismissedAt)),
        ),
      )
      .orderBy(desc(t.reviews.createdAt));
    return rows.map(toSource);
  }

  async loadPrDiff(workspaceId: string, prId: string): Promise<string | undefined> {
    const repo = this.container.reviewRepo;
    const pull = await repo.getPull(workspaceId, prId);
    if (!pull) return undefined;
    const repoRow = await repo.getRepo(pull.repoId);
    if (!repoRow) return undefined;
    const diff = await loadDiff(this.container, repo, workspaceId, pull, repoRow);
    return diff.raw.length > 0 ? diff.raw : undefined;
  }
}
