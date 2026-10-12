import { describe, expect, it } from "vitest";
import { parsePublicSnapshot, parseTourState, UnexpectedResponseError } from "./parse";
import { content, provenance, stateFixture } from "./test-fixtures";

describe("response guards", () => {
  it("accepts well-formed state and snapshots", () => {
    expect(parseTourState(stateFixture()).availability).toBe("ready");
    expect(parseTourState(stateFixture({ availability: "no_tour", tour: null })).tour).toBeNull();
    const snap = { repository: { provider: "github", full_name: "acme/api" }, content, provenance, shared_at: "2026-10-11T12:00:00.000Z" };
    expect(parsePublicSnapshot(snap).repository.full_name).toBe("acme/api");
  });
  it("rejects drifted or hostile payloads", () => {
    expect(() => parseTourState(null)).toThrow(UnexpectedResponseError);
    expect(() => parseTourState({ ...stateFixture(), availability: "weird" })).toThrow(UnexpectedResponseError);
    expect(() => parseTourState({ ...stateFixture(), tour: null })).toThrow(UnexpectedResponseError); // ready without a tour
    const swapped = { ...content, sections: [content.sections[1], content.sections[0], ...content.sections.slice(2)] };
    expect(() => parseTourState({ ...stateFixture(), tour: { ...stateFixture().tour!, content: swapped } })).toThrow(UnexpectedResponseError);
    expect(() => parseTourState({ ...stateFixture(), tour: { ...stateFixture().tour!, provenance: { ...provenance, source_sha: "main" } } })).toThrow(UnexpectedResponseError);
    expect(() => parsePublicSnapshot({ repository: { full_name: "../../etc" }, content, provenance, shared_at: "x" })).toThrow(UnexpectedResponseError);
  });
});
