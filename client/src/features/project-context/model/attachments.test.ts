import { describe, expect, it } from "vitest";
import type { SpecFile } from "@devdigest/shared";
import {
  attachedTokens,
  buildRows,
  moveAttachment,
  normalizeOrder,
  overWarning,
  reorderAttachment,
  toggleAttachment,
} from "./attachments";

const FILES: SpecFile[] = [
  { path: "specs/a.md", type: "specs", tokens: 100 },
  { path: "docs/b.md", type: "docs", tokens: 50 },
  { path: "insights/c.md", type: "insights", tokens: null },
];

describe("attachment model", () => {
  it("toggle appends at the end with contiguous orders, and detaches again", () => {
    const one = toggleAttachment([], "specs/a.md");
    expect(one).toEqual([{ path: "specs/a.md", order: 0 }]);
    const two = toggleAttachment(one, "docs/b.md");
    expect(two).toEqual([
      { path: "specs/a.md", order: 0 },
      { path: "docs/b.md", order: 1 },
    ]);
    expect(toggleAttachment(two, "specs/a.md")).toEqual([{ path: "docs/b.md", order: 0 }]);
  });

  it("move up/down swaps neighbours and is a no-op at the ends", () => {
    const cur = normalizeOrder([{ path: "a" }, { path: "b" }, { path: "c" }]);
    expect(moveAttachment(cur, "b", -1).map((d) => d.path)).toEqual(["b", "a", "c"]);
    expect(moveAttachment(cur, "b", 1).map((d) => d.path)).toEqual(["a", "c", "b"]);
    expect(moveAttachment(cur, "a", -1).map((d) => d.path)).toEqual(["a", "b", "c"]);
    expect(moveAttachment(cur, "c", 1).map((d) => d.path)).toEqual(["a", "b", "c"]);
    expect(moveAttachment(cur, "zzz", 1).map((d) => d.path)).toEqual(["a", "b", "c"]);
  });

  it("drag reorder puts the dragged item where the target sits", () => {
    const cur = normalizeOrder([{ path: "a" }, { path: "b" }, { path: "c" }]);
    expect(reorderAttachment(cur, "a", "c").map((d) => d.path)).toEqual(["b", "c", "a"]);
    expect(reorderAttachment(cur, "c", "a").map((d) => d.path)).toEqual(["c", "a", "b"]);
    expect(reorderAttachment(cur, "a", "a").map((d) => d.path)).toEqual(["a", "b", "c"]);
  });

  it("rows list attached docs first in order (missing ones flagged), then the rest", () => {
    const rows = buildRows(FILES, [
      { path: "docs/b.md", order: 1 },
      { path: "specs/gone.md", order: 0 },
    ], "");
    expect(rows.map((r) => [r.path, r.attached, r.missing])).toEqual([
      ["specs/gone.md", true, true],
      ["docs/b.md", true, false],
      ["specs/a.md", false, false],
      ["insights/c.md", false, false],
    ]);
  });

  it("filter is a case-insensitive path substring and never changes the attached set", () => {
    const attached = [{ path: "specs/a.md", order: 0 }];
    const rows = buildRows(FILES, attached, "DOCS/");
    expect(rows.map((r) => r.path)).toEqual(["docs/b.md"]);
    expect(attached).toEqual([{ path: "specs/a.md", order: 0 }]);
  });

  it("totals tokens of attached docs only, ignoring missing and unknown counts", () => {
    expect(attachedTokens(FILES, [])).toBe(0);
    expect(
      attachedTokens(FILES, [
        { path: "specs/a.md", order: 0 },
        { path: "docs/b.md", order: 1 },
        { path: "insights/c.md", order: 2 },
        { path: "specs/gone.md", order: 3 },
      ]),
    ).toBe(150);
  });

  it("warns only strictly above the server threshold", () => {
    expect(overWarning(100_000, { warn_tokens: 100_000 })).toBe(false);
    expect(overWarning(100_001, { warn_tokens: 100_000 })).toBe(true);
    expect(overWarning(5, undefined)).toBe(false);
  });
});
