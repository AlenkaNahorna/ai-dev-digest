import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { parsePatch } from "./helpers";
import { keysForLine } from "./comments";
import { partitionFindings, severityLabelKey, topSeverity } from "./findings";

const fnd = (id: string, line: number, severity = "WARNING"): FindingRecord => ({
  id, severity, category: "bug", title: id, file: "a.ts", start_line: line, end_line: line,
  rationale: "r", suggestion: null, confidence: 0.9, kind: "finding", trifecta_components: null,
  evidence: null, review_id: "r1", accepted_at: null, dismissed_at: null,
}) as FindingRecord;

// new lines: 10 (ctx), 11 (add), 12 (ctx); old line 11 deleted
const PATCH = "@@ -10,3 +10,3 @@\n a\n-old\n+new\n b";
const keys = new Set(parsePatch(PATCH).flatMap((l) => keysForLine(l)));

describe("partitionFindings", () => {
  it("anchors on add and context lines by RIGHT key; multi-findings share a line", () => {
    const { matched, unanchored } = partitionFindings([fnd("a", 11), fnd("b", 10), fnd("c", 11)], keys);
    expect(matched.get("RIGHT:11")!.map((f) => f.id)).toEqual(["a", "c"]);
    expect(matched.get("RIGHT:10")!.map((f) => f.id)).toEqual(["b"]);
    expect(unanchored).toEqual([]);
  });

  it("puts findings outside the patch into unanchored (never dropped)", () => {
    const { matched, unanchored } = partitionFindings([fnd("x", 999)], keys);
    expect(matched.size).toBe(0);
    expect(unanchored.map((f) => f.id)).toEqual(["x"]);
  });

  it("a deleted-only line has no RIGHT key", () => {
    const del = parsePatch("@@ -5,1 +5,0 @@\n-gone");
    const k = new Set(del.flatMap((l) => keysForLine(l)));
    expect(partitionFindings([fnd("d", 5)], k).unanchored).toHaveLength(1);
  });
});

describe("severity helpers", () => {
  it("topSeverity ranks CRITICAL > WARNING > SUGGESTION", () => {
    expect(topSeverity([fnd("a", 1, "SUGGESTION"), fnd("b", 1, "CRITICAL"), fnd("c", 1, "WARNING")])).toBe("CRITICAL");
    expect(topSeverity([fnd("a", 1, "SUGGESTION"), fnd("c", 1, "WARNING")])).toBe("WARNING");
  });
  it("maps severities to stripe labels with a safe fallback", () => {
    expect(severityLabelKey("CRITICAL")).toBe("blocker");
    expect(severityLabelKey("WARNING")).toBe("warning");
    expect(severityLabelKey("SUGGESTION")).toBe("suggestion");
    expect(severityLabelKey("INFO")).toBe("suggestion");
  });
});
