import { describe, it, expect } from "vitest";
import { deltaPoints, pct, versionLabel } from "./format";
import { diffLines } from "./line-diff";

describe("eval format helpers", () => {
  it("shows percentages and a dash for null (AC-29)", () => {
    expect(pct(0.824)).toBe("82%");
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
  });
  it("formats signed points with a tone", () => {
    expect(deltaPoints(0.04)).toEqual({ text: "+4pt", tone: "up" });
    expect(deltaPoints(-0.02)).toEqual({ text: "−2pt", tone: "down" });
    expect(deltaPoints(0)).toEqual({ text: "0pt", tone: "flat" });
    expect(deltaPoints(null)).toEqual({ text: "—", tone: "none" });
  });
  it("labels versions", () => {
    expect(versionLabel(7)).toBe("v7");
    expect(versionLabel(null)).toBe("—");
  });
});

describe("diffLines (prompt comparison, AC-35)", () => {
  it("marks added and removed lines and keeps unchanged ones", () => {
    const out = diffLines("a\nb\nc", "a\nB\nc\nd");
    expect(out).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });
  it("is empty-safe", () => {
    expect(diffLines("", "")).toEqual([{ kind: "same", text: "" }]);
  });
});

import { diffFiles, formatExpectation, parseExpectationText } from "./draft";

describe("modal draft helpers", () => {
  const exp = {
    kind: "must_find" as const,
    file: "src/a.ts",
    start_line: 9,
    end_line: 12,
    title: "Missing auth",
    severity: "CRITICAL" as const,
    category: "security" as const,
  };
  it("round-trips the seeded expectation", () => {
    const r = parseExpectationText(formatExpectation(exp));
    expect(r).toEqual({ ok: true, value: exp });
  });
  it("flags broken JSON, wrong kind, bad lines and missing fields", () => {
    expect(parseExpectationText("{")).toEqual({ ok: false, error: "invalid_json" });
    expect(parseExpectationText("[1]")).toEqual({ ok: false, error: "not_object" });
    expect(parseExpectationText(JSON.stringify({ ...exp, kind: "maybe" }))).toEqual({ ok: false, error: "kind" });
    expect(parseExpectationText(JSON.stringify({ ...exp, file: " " }))).toEqual({ ok: false, error: "file" });
    expect(parseExpectationText(JSON.stringify({ ...exp, start_line: 0 }))).toEqual({ ok: false, error: "lines" });
    expect(parseExpectationText(JSON.stringify({ ...exp, start_line: 13 }))).toEqual({ ok: false, error: "line_order" });
    expect(parseExpectationText(JSON.stringify({ ...exp, title: 3 }))).toEqual({ ok: false, error: "fields" });
  });
  it("lists the files of a diff once each", () => {
    const d = "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n--- a/y.ts\n+++ b/y.ts\n--- a/x.ts\n+++ b/x.ts\n";
    expect(diffFiles(d)).toEqual(["x.ts", "y.ts"]);
    expect(diffFiles("")).toEqual([]);
  });
});
