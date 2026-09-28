import { describe, expect, it } from "vitest";
import { pullKeys, reviewKeys, runKeys } from "./query-keys";

describe("query key factories", () => {
  it("keeps feature keys stable and scoped", () => {
    expect(pullKeys.list("repo-1")).toEqual(["pulls", "repo-1"]);
    expect(reviewKeys.byPull("pr-1")).toEqual(["reviews", "pr-1"]);
    expect(reviewKeys.smartDiff("pr-1")).toEqual(["reviews", "pr-1", "smart-diff"]);
    expect(runKeys.active("pr-1")).toEqual(["pr-active-runs", "pr-1"]);
  });
});
