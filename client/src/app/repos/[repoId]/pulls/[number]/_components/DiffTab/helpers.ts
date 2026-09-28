import type { FindingRecord, PrFile, ReviewRecord, SmartDiffResponse, SmartDiffRole } from "@devdigest/shared";
import { latestReviewsPerAgent } from "@/features/reviews/model/rollups";
import { DEFAULT_COLLAPSED_ROLES } from "./constants";

export interface DiffGroupModel {
  role: SmartDiffRole;
  /** In ORIGINAL pr.files (GitHub) order. */
  files: PrFile[];
  /** Number of FILES with findings (not the number of findings). */
  findingFileCount: number;
  findingPaths: Set<string>;
  defaultOpen: boolean;
}

/** Findings of the newest review per agent (same set as the PR list rollups). */
export function latestFindings(reviews: ReviewRecord[] | undefined): FindingRecord[] {
  return latestReviewsPerAgent(reviews ?? []).flatMap((r) => r.findings);
}

/**
 * Group `files` by the smart-diff roles (group order from the server, file order
 * from `files`). Files missing from the response go to `ungrouped`.
 */
export function buildDiffGroups(
  files: PrFile[],
  smart: SmartDiffResponse,
): { groups: DiffGroupModel[]; ungrouped: PrFile[] } {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const placed = new Set<string>();
  const groups: DiffGroupModel[] = [];
  for (const g of smart.groups) {
    const inGroup = new Set(g.files.map((f) => f.path));
    const groupFiles = files.filter((f) => inGroup.has(f.path) && byPath.has(f.path));
    if (groupFiles.length === 0) continue;
    const findingPaths = new Set(g.files.filter((f) => f.finding_lines.length > 0).map((f) => f.path));
    for (const f of groupFiles) placed.add(f.path);
    groups.push({
      role: g.role,
      files: groupFiles,
      findingFileCount: groupFiles.filter((f) => findingPaths.has(f.path)).length,
      findingPaths,
      defaultOpen: !DEFAULT_COLLAPSED_ROLES.includes(g.role),
    });
  }
  return { groups, ungrouped: files.filter((f) => !placed.has(f.path)) };
}
