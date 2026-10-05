import { describe, it, expect } from "vitest";
import type { BlastRadius } from "@devdigest/shared";
import { blastCounts, callersForSymbol, degradedMessageKey, incompleteMessageKey, isIndexIncomplete, symbolEntries } from "./helpers";

const data: BlastRadius = {
  changed_symbols: [
    { name: "a", file: "src/a.ts", kind: "function" },
    { name: "b", file: "src/b.ts", kind: "function" },
    { name: "c", file: "src/c.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "a",
      callers: [{ name: "x", file: "x.ts", line: 1 }, { name: "y", file: "y.ts", line: 2 }],
      endpoints_affected: ["GET /one", "GET /two"],
      crons_affected: ["nightly"],
    },
    { symbol: "b", callers: [{ name: "z", file: "z.ts", line: 3 }], endpoints_affected: ["GET /one"], crons_affected: [] },
  ],
  summary: "stale text that must be ignored",
};

describe("blastCounts", () => {
  it("counts from the rows, with endpoints and crons de-duplicated across groups", () => {
    expect(blastCounts(data)).toEqual({ symbols: 3, callers: 3, endpoints: 2, crons: 1 });
  });

  it("is all zeros for an empty result", () => {
    expect(blastCounts({ changed_symbols: [], downstream: [], summary: "" })).toEqual({ symbols: 0, callers: 0, endpoints: 0, crons: 0 });
  });
});

describe("callersForSymbol", () => {
  it("finds the group by symbol name, or undefined", () => {
    expect(callersForSymbol(data, "b")?.callers).toHaveLength(1);
    expect(callersForSymbol(data, "c")).toBeUndefined();
  });
});

describe("degradedMessageKey", () => {
  it("maps every reason to its own key", () => {
    expect(degradedMessageKey("no_data")).toBe("degraded.no_data");
    expect(degradedMessageKey("flag_off")).toBe("degraded.flag_off");
    expect(degradedMessageKey("index_failed")).toBe("degraded.index_failed");
    expect(degradedMessageKey("index_partial")).toBe("degraded.index_partial");
    expect(degradedMessageKey("repo_too_large")).toBe("degraded.repo_too_large");
  });

  it("falls back to generic copy without a reason", () => {
    expect(degradedMessageKey(undefined)).toBe("degraded.generic");
  });
});

describe("isIndexIncomplete / incompleteMessageKey", () => {
  const ok: BlastRadius = { changed_symbols: [], downstream: [], summary: "" };

  it("is incomplete for degraded data or any index status but full", () => {
    expect(isIndexIncomplete(ok, undefined)).toBe(false);
    expect(isIndexIncomplete(ok, "full")).toBe(false);
    expect(isIndexIncomplete(ok, "partial")).toBe(true);
    expect(isIndexIncomplete({ ...ok, degraded: true }, "full")).toBe(true);
  });

  it("explains partial/failed from the index status and prefers the blast reason", () => {
    expect(incompleteMessageKey(ok, "partial", undefined)).toBe("degraded.index_partial");
    expect(incompleteMessageKey(ok, "failed", undefined)).toBe("degraded.index_failed");
    expect(incompleteMessageKey(ok, "degraded", "flag_off")).toBe("degraded.flag_off");
    expect(incompleteMessageKey(ok, "degraded", "something_new")).toBe("degraded.generic");
    expect(incompleteMessageKey({ ...ok, degraded: true, degraded_reason: "no_data" }, "partial", undefined)).toBe("degraded.no_data");
  });
});

describe("symbolEntries", () => {
  it("merges same-named symbols from different files into one entry", () => {
    const entries = symbolEntries({
      changed_symbols: [
        { name: "handler", file: "a.ts", kind: "function" },
        { name: "other", file: "c.ts", kind: "function" },
        { name: "handler", file: "b.ts", kind: "function" },
      ],
      downstream: [],
      summary: "",
    });
    expect(entries.map((e) => [e.symbol.name, e.symbol.file, e.extraFiles])).toEqual([["handler", "a.ts", 1], ["other", "c.ts", 0]]);
  });
});
