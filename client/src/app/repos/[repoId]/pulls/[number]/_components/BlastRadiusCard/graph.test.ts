import { describe, it, expect } from "vitest";
import type { BlastRadius } from "@devdigest/shared";
import { buildGraph, truncate } from "./graph";

const data: BlastRadius = {
  changed_symbols: [
    { name: "rateLimit", file: "src/rate.ts", kind: "function" },
    { name: "lonely", file: "src/l.ts", kind: "function" },
    { name: "bucketKey", file: "src/bucket.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "rateLimit",
      callers: [{ name: "publicRouter", file: "src/a.ts", line: 1 }, { name: "app", file: "src/server.ts", line: 88 }],
      endpoints_affected: ["GET /api/public/items"],
      crons_affected: ["reset-buckets"],
    },
    {
      symbol: "bucketKey",
      callers: [{ name: "app", file: "src/server.ts", line: 90 }],
      endpoints_affected: ["GET /api/public/items"],
      crons_affected: [],
    },
  ],
  summary: "",
};

describe("buildGraph", () => {
  it("has symbols with callers, de-duplicated callers and targets, and skips symbols nobody calls", () => {
    const g = buildGraph(data);
    const ids = (kind: string) => g.nodes.filter((n) => n.kind === kind).map((n) => n.id);
    expect(ids("symbol")).toEqual(["s:rateLimit", "s:bucketKey"]);
    expect(ids("caller")).toEqual(["c:src/a.ts:publicRouter", "c:src/server.ts:app"]);
    expect(ids("endpoint")).toEqual(["e:GET /api/public/items"]);
    expect(ids("cron")).toEqual(["k:reset-buckets"]);
  });

  it("links symbol -> caller and caller -> endpoint/cron of the same group, without duplicate edges", () => {
    const g = buildGraph(data);
    const ids = g.edges.map((e) => e.id);
    expect(ids).toContain("s:rateLimit>c:src/a.ts:publicRouter");
    expect(ids).toContain("c:src/server.ts:app>e:GET /api/public/items");
    expect(ids).toContain("c:src/server.ts:app>k:reset-buckets");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lays out three columns left to right with every node inside the canvas", () => {
    const g = buildGraph(data);
    const xOf = (kind: string) => g.nodes.find((n) => n.kind === kind)!.x;
    expect(xOf("symbol")).toBeLessThan(xOf("caller"));
    expect(xOf("caller")).toBeLessThan(xOf("endpoint"));
    for (const n of g.nodes) {
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.height).toBeLessThanOrEqual(g.height);
      expect(n.x + n.width).toBeLessThanOrEqual(g.width);
    }
  });

  it("is empty when no symbol has callers", () => {
    const g = buildGraph({ changed_symbols: [{ name: "a", file: "a.ts", kind: "function" }], downstream: [], summary: "" });
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});

describe("buildGraph with same-named symbols", () => {
  it("draws one symbol node per name, so node ids stay unique", () => {
    const g = buildGraph({
      changed_symbols: [
        { name: "handler", file: "src/a.ts", kind: "function" },
        { name: "handler", file: "src/b.ts", kind: "function" },
      ],
      downstream: [{ symbol: "handler", callers: [{ name: "route", file: "src/r.ts", line: 4 }], endpoints_affected: ["GET /x"], crons_affected: [] }],
      summary: "",
    });
    const ids = g.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(g.nodes.filter((n) => n.kind === "symbol")).toHaveLength(1);
  });
});

describe("truncate", () => {
  it("keeps short text and shortens long text with an ellipsis", () => {
    expect(truncate("app", 150)).toBe("app");
    const long = truncate("POST /api/public/webhooks/very/long/path", 150);
    expect(long.endsWith("\u2026")).toBe(true);
    expect(long.length).toBeLessThan(25);
  });
});
