import { describe, expect, it } from "vitest";
import { contextKeys, pullKeys, reviewKeys, runKeys } from "./query-keys";

describe("query key factories", () => {
  it("keeps feature keys stable and scoped", () => {
    expect(pullKeys.list("repo-1")).toEqual(["pulls", "repo-1"]);
    expect(reviewKeys.byPull("pr-1")).toEqual(["reviews", "pr-1"]);
    expect(reviewKeys.smartDiff("pr-1")).toEqual(["reviews", "pr-1", "smart-diff"]);
    expect(runKeys.active("pr-1")).toEqual(["pr-active-runs", "pr-1"]);
    expect(contextKeys.list("repo-1")).toEqual(["project-context", "list", "repo-1"]);
    expect(contextKeys.attachments("agent", "a-1", "repo-1")).toEqual(["project-context", "attachments", "agent", "a-1", "repo-1"]);
  });
});
