import type { FindingRecord, PrFile, ReviewRecord, SmartDiffResponse, SmartDiffRole } from "@devdigest/shared";
import { latestReviewsPerAgent } from "@/features/reviews/model/rollups";
import { DEFAULT_COLLAPSED_ROLES, SMART_DIFF_ROLE_ORDER } from "./constants";

export interface DiffGroupModel {
  role: SmartDiffRole;
  /** In ORIGINAL pr.files (GitHub) order. */
  files: PrFile[];
  /** Number of findings in this group. */
  findingCount: number;
  findingPaths: Set<string>;
  defaultOpen: boolean;
}

/** Findings of the newest review per agent (same set as the PR list rollups). */
export function latestFindings(reviews: ReviewRecord[] | undefined): FindingRecord[] {
  return latestReviewsPerAgent(reviews ?? []).flatMap((r) => r.findings);
}

/**
 * Group `files` by the smart-diff roles (canonical role order, file order from
 * `files`). Categories with no files remain as empty groups; unmatched files go
 * to `ungrouped`.
 */
export function buildDiffGroups(
  files: PrFile[],
  smart: SmartDiffResponse,
  findings: Pick<FindingRecord, "file">[],
): { groups: DiffGroupModel[]; ungrouped: PrFile[] } {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const findingCountByPath = new Map<string, number>();
  for (const finding of findings) {
    findingCountByPath.set(finding.file, (findingCountByPath.get(finding.file) ?? 0) + 1);
  }
  const placed = new Set<string>();
  const groups: DiffGroupModel[] = [];
  const groupsByRole = new Map(smart.groups.map((group) => [group.role, group]));
  for (const role of SMART_DIFF_ROLE_ORDER) {
    const sourceGroup = groupsByRole.get(role);
    const inGroup = new Set(sourceGroup?.files.map((f) => f.path) ?? []);
    const groupFiles = files.filter((f) => inGroup.has(f.path) && byPath.has(f.path));
    const findingPaths = new Set(
      sourceGroup?.files.filter((f) => f.finding_lines.length > 0).map((f) => f.path) ?? [],
    );
    for (const f of groupFiles) placed.add(f.path);
    groups.push({
      role,
      files: groupFiles,
      findingCount: groupFiles.reduce((count, file) => count + (findingCountByPath.get(file.path) ?? 0), 0),
      findingPaths,
      defaultOpen: !DEFAULT_COLLAPSED_ROLES.includes(role),
    });
  }
  return { groups, ungrouped: files.filter((f) => !placed.has(f.path)) };
}
