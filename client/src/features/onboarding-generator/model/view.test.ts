import { describe, expect, it } from "vitest";
import type { ArchitectureDiagram } from "@devdigest/shared/contracts/onboarding-generator";
import { activeKeyFor } from "@/components/app-shell/helpers";
import {
  bannersFor,
  diagramTextAlternative,
  isSafeHttpUrl,
  layoutDiagram,
  provenanceLine,
  screenMode,
  sectionAnchor,
  shortSha,
  sourceUrl,
} from "./view";
import { SHA, provenance, stateFixture } from "./test-fixtures";

describe("sourceUrl", () => {
  it("pins the link to the stored commit and encodes the path", () => {
    expect(sourceUrl("acme/api", SHA, "src/a b/c#d.ts")).toBe(`https://github.com/acme/api/blob/${SHA}/src/a%20b/c%23d.ts`);
  });
  it("returns null (inert) for unsafe input", () => {
    expect(sourceUrl("acme/api", "main", "src/a.ts")).toBeNull();
    expect(sourceUrl("acme/api", SHA, "../etc/passwd")).toBeNull();
    expect(sourceUrl("acme/api", SHA, "/abs")).toBeNull();
    expect(sourceUrl("acme/api/extra", SHA, "a.ts")).toBeNull();
    expect(sourceUrl("javascript:alert(1)//x", SHA, "a.ts")).toBeNull();
    expect(sourceUrl(null, SHA, "a.ts")).toBeNull();
  });
});

describe("isSafeHttpUrl", () => {
  it("allows only http(s)", () => {
    expect(isSafeHttpUrl("https://example.com/x")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,x")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
  });
});

describe("state helpers", () => {
  it("maps availability to screen modes", () => {
    expect(screenMode(undefined)).toBe("loading");
    expect(screenMode(stateFixture({ availability: "index_required", tour: null }))).toBe("index_required");
    expect(screenMode(stateFixture({ availability: "no_tour", tour: null }))).toBe("no_tour");
    expect(screenMode(stateFixture())).toBe("ready");
  });
  it("derives banners: generating keeps the old tour, failure shows the safe message, stale names both commits", () => {
    expect(bannersFor(stateFixture())).toEqual([]);
    const gen = bannersFor(stateFixture({ generation: { status: "running", request_id: "r", trigger: "manual", requested_at: null, error_category: null, message: null } }));
    expect(gen[0]?.kind).toBe("generating");
    expect(gen[0]?.text).toMatch(/previous version stays visible/);
    const failed = bannersFor(stateFixture({ generation: { status: "failed", request_id: "r", trigger: "manual", requested_at: null, error_category: "timeout", message: "Timed out." } }));
    expect(failed[0]).toMatchObject({ kind: "failed", text: "Timed out." });
    const newSha = "f".repeat(40);
    const stale = bannersFor(stateFixture({ stale: true, current_index: { source_sha: newSha, indexed_at: "2026-10-12T00:00:00.000Z", index_status: "full" } }));
    expect(stale[0]?.text).toContain(shortSha(newSha));
    expect(stale[0]?.text).toContain(shortSha(SHA));
  });
  it("builds a truthful provenance line", () => {
    const line = provenanceLine(provenance);
    expect(line).toContain(`commit ${SHA.slice(0, 7)}`);
    expect(line).toContain("4 docs");
    expect(line).not.toContain("12,450");
    expect(provenanceLine({ ...provenance, index_status: "partial", evidence: { ...provenance.evidence, truncated: true } })).toMatch(/partial index.*not exhaustive/);
  });
  it("section anchors are stable ids", () => {
    expect(sectionAnchor("critical_paths")).toBe("onboarding-critical-paths");
  });
});

describe("diagram layout", () => {
  const d: ArchitectureDiagram = {
    nodes: [
      { id: "a", label: "A", kind: "service", path: null },
      { id: "b", label: "B", kind: "module", path: null },
      { id: "c", label: "C", kind: "datastore", path: null },
    ],
    edges: [
      { from: "a", to: "b", label: null },
      { from: "b", to: "c", label: "sql" },
    ],
  };
  it("is deterministic and layers left→right", () => {
    const one = layoutDiagram(d);
    expect(layoutDiagram(d)).toEqual(one);
    const x = (id: string) => one.nodes.find((n) => n.id === id)!.x;
    expect(x("a")).toBeLessThan(x("b"));
    expect(x("b")).toBeLessThan(x("c"));
    expect(one.edges).toHaveLength(2);
  });
  it("tolerates cycles", () => {
    const cyc: ArchitectureDiagram = { ...d, edges: [...d.edges, { from: "c", to: "a", label: null }] };
    const out = layoutDiagram(cyc);
    expect(out.nodes).toHaveLength(3);
    expect(out.width).toBeGreaterThan(0);
  });
  it("offers a text alternative covering every relationship and isolated node", () => {
    const lines = diagramTextAlternative({ ...d, nodes: [...d.nodes, { id: "z", label: "Z", kind: "other", path: null }] });
    expect(lines).toContain("A → B");
    expect(lines).toContain("B → C (sql)");
    expect(lines).toContain("Z");
  });
});

describe("activeKeyFor", () => {
  it("highlights Onboarding Tour only on the repo-scoped route, not on add-repository", () => {
    expect(activeKeyFor("/repos/abc/onboarding")).toBe("onboarding-tour");
    expect(activeKeyFor("/onboarding")).toBe("");
    expect(activeKeyFor("/repos/abc/pulls")).toBe("pulls");
  });
});
