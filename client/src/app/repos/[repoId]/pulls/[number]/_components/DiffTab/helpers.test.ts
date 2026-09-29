import { describe, it, expect } from "vitest";
import type { PrFile, SmartDiffResponse } from "@devdigest/shared";
import { buildDiffGroups } from "./helpers";

const f = (path: string): PrFile => ({ path, additions: 1, deletions: 0, patch: null }) as PrFile;
const sf = (path: string, lines: number[] = []) => ({ path, additions: 1, deletions: 0, finding_lines: lines });
const finding = (file: string): Pick<import("@devdigest/shared").FindingRecord, "file"> => ({ file });

const smart: SmartDiffResponse = {
  groups: [
    { role: "core", files: [sf("a.ts", [1, 2, 3]), sf("b.ts", [9, 10]), sf("c.ts")] },
    { role: "tests", files: [sf("a.test.ts")] },
    { role: "wiring", files: [sf("index.ts")] },
    { role: "docs", files: [sf("README.md")] },
    { role: "boilerplate", files: [sf("pnpm-lock.yaml")] },
  ],
  split_suggestion: { too_big: false, total_lines: 6, proposed_splits: [] },
};

describe("buildDiffGroups", () => {
  const files = ["pnpm-lock.yaml", "c.ts", "README.md", "a.ts", "index.ts", "a.test.ts", "b.ts"].map(f);

  it("keeps the five groups in order, docs/boilerplate collapsed, lock file in boilerplate", () => {
    const { groups, ungrouped } = buildDiffGroups(files, smart, []);
    expect(groups.map((g) => g.role)).toEqual(["core", "tests", "wiring", "docs", "boilerplate"]);
    expect(groups.map((g) => g.defaultOpen)).toEqual([true, true, true, false, false]);
    expect(groups[4]!.files.map((x) => x.path)).toEqual(["pnpm-lock.yaml"]);
    expect(ungrouped).toEqual([]);
  });

  it("orders files inside a group by pr.files order", () => {
    const { groups } = buildDiffGroups(files, smart, []);
    expect(groups[0]!.files.map((x) => x.path)).toEqual(["c.ts", "a.ts", "b.ts"]);
  });

  it("counts findings rather than affected files", () => {
    const { groups } = buildDiffGroups(files, smart, [
      finding("a.ts"), finding("a.ts"), finding("a.ts"), finding("b.ts"), finding("b.ts"),
    ]);
    expect(groups[0]!.findingCount).toBe(5);
    expect(groups[1]!.findingCount).toBe(0);
  });

  it("keeps empty categories and puts files absent from smart-diff into ungrouped", () => {
    const { groups, ungrouped } = buildDiffGroups([f("a.ts"), f("new.ts")], smart, []);
    expect(groups.map((g) => g.role)).toEqual(["core", "tests", "wiring", "docs", "boilerplate"]);
    expect(groups.slice(1).map((g) => g.files)).toEqual([[], [], [], []]);
    expect(ungrouped.map((x) => x.path)).toEqual(["new.ts"]);
  });
});
