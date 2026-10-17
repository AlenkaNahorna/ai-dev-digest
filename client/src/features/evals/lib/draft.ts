import type { EvalExpectation } from "@devdigest/shared";

export type ParsedExpectation = { ok: true; value: EvalExpectation } | { ok: false; error: string };

export function formatExpectation(e: EvalExpectation): string {
  return JSON.stringify(e, null, 2);
}

const isLine = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isText = (v: unknown): v is string => typeof v === "string";

/**
 * Light client-side check of the JSON the user edits (shape only — the server validates severity /
 * category against the contract and answers 400 if they are wrong). Drives the "valid JSON" badge.
 */
export function parseExpectationText(text: string): ParsedExpectation {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "not_object" };
  const o = raw as Record<string, unknown>;
  if (o.kind !== "must_find" && o.kind !== "must_not_flag") return { ok: false, error: "kind" };
  if (!isText(o.file) || o.file.trim() === "") return { ok: false, error: "file" };
  if (!isLine(o.start_line) || !isLine(o.end_line)) return { ok: false, error: "lines" };
  if (o.start_line > o.end_line) return { ok: false, error: "line_order" };
  if (!isText(o.title) || !isText(o.severity) || !isText(o.category)) return { ok: false, error: "fields" };
  return { ok: true, value: o as unknown as EvalExpectation };
}

/** Files touched by a unified diff (`+++ b/path`), in order, without duplicates. */
export function diffFiles(diff: string): string[] {
  const out: string[] = [];
  for (const line of diff.split("\n")) {
    const m = /^\+\+\+ (?:b\/)?(.+?)\s*$/.exec(line);
    if (m && m[1] !== "/dev/null" && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}
