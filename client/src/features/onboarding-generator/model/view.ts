import type {
  ArchitectureDiagram,
  GenerationState,
  OnboardingTourState,
  TourProvenance,
} from "@devdigest/shared/contracts/onboarding-generator";

/** Section keys in their fixed display order, with the titles used in cards and "ON THIS PAGE". */
export const SECTION_TITLES = {
  architecture: "Architecture overview",
  critical_paths: "Critical paths",
  local_run: "How to run locally",
  reading_path: "Guided reading path",
  first_tasks: "First tasks",
} as const;
export type SectionKey = keyof typeof SECTION_TITLES;
export const SECTION_ORDER = Object.keys(SECTION_TITLES) as SectionKey[];

export const sectionAnchor = (key: string) => `onboarding-${key.replace(/_/g, "-")}`;

const SHA = /^[0-9a-f]{40}$/;
export const shortSha = (sha: string) => (SHA.test(sha) ? sha.slice(0, 7) : "unknown");

/** Encode a repo-relative path for a URL while keeping "/" separators. */
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/**
 * Provider source link pinned to the commit the tour was generated from, so it
 * stays correct after the default branch moves on. Returns null (→ inert text)
 * for anything that is not a plain GitHub `owner/name` + full SHA + safe path.
 */
export function sourceUrl(repoFullName: string | null | undefined, sha: string, path: string): string | null {
  if (!repoFullName || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoFullName)) return null;
  if (!SHA.test(sha)) return null;
  if (!path || path.startsWith("/") || path.split("/").some((s) => s === "" || s === "." || s === "..")) return null;
  return `https://github.com/${repoFullName}/blob/${sha}/${encPath(path)}`;
}

/** Only absolute http(s) URLs may become clickable (links inside model text are otherwise inert). */
export function isSafeHttpUrl(href: string | null | undefined): boolean {
  if (!href) return false;
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export type ScreenMode =
  | "loading"
  | "index_required"
  | "no_tour"
  | "ready";

export function screenMode(state: OnboardingTourState | undefined): ScreenMode {
  if (!state) return "loading";
  return state.availability;
}

export type Banner =
  | { kind: "generating"; text: string }
  | { kind: "failed"; text: string }
  | { kind: "budget"; text: string }
  | { kind: "stale"; text: string };

/** At most the banners that apply right now, most important first. The tour (if any) stays visible beneath. */
export function bannersFor(state: OnboardingTourState): Banner[] {
  const out: Banner[] = [];
  const g: GenerationState = state.generation;
  if (g.status === "queued" || g.status === "running") {
    out.push({
      kind: "generating",
      text: state.tour
        ? "A new tour is being generated. The previous version stays visible until it is ready."
        : "Generating the tour from the indexed repository…",
    });
  } else if (g.status === "failed") {
    out.push({ kind: "failed", text: g.message ?? "The last generation attempt failed." });
  } else if (g.status === "budget_reached") {
    out.push({ kind: "budget", text: g.message ?? "The daily generation limit for this repository was reached." });
  }
  if (state.stale && state.tour && state.current_index) {
    out.push({
      kind: "stale",
      text: `The repository was re-indexed (now ${shortSha(state.current_index.source_sha)}) after this tour was generated from ${shortSha(state.tour.provenance.source_sha)}.`,
    });
  }
  return out;
}

/** Truthful provenance line: only counts that were actually captured. */
export function provenanceLine(p: TourProvenance): string {
  const e = p.evidence;
  const parts = [
    `commit ${shortSha(p.source_sha)}`,
    `indexed ${new Date(p.indexed_at).toLocaleString()}`,
    `${e.documents_used} doc${e.documents_used === 1 ? "" : "s"}`,
    `${e.ranked_files} ranked file${e.ranked_files === 1 ? "" : "s"}`,
    `${e.symbols} symbol${e.symbols === 1 ? "" : "s"}`,
  ];
  if (p.index_status === "partial") parts.push("partial index");
  if (e.truncated) parts.push("evidence sampled, not exhaustive");
  return parts.join(" · ");
}

// ------------------------------------------------------------------ diagram

export const NODE_W = 150;
export const NODE_H = 44;
const GAP_X = 70;
const GAP_Y = 22;
const PAD = 16;

export interface LaidOutNode {
  id: string;
  label: string;
  kind: string;
  path: string | null;
  x: number;
  y: number;
}
export interface LaidOutEdge {
  from: string;
  to: string;
  label: string | null;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface DiagramLayout {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

/**
 * Deterministic layered left→right layout. Layers are longest-path depths from the
 * nodes without incoming edges; cycles are tolerated (back edges are ignored when
 * assigning layers). Pure: the same diagram always yields the same geometry.
 */
export function layoutDiagram(d: ArchitectureDiagram): DiagramLayout {
  const ids = d.nodes.map((n) => n.id);
  const incoming = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const e of d.edges) if (e.from !== e.to) incoming.get(e.to)?.push(e.from);

  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // cycle: ignore the back edge
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const v = parents.length === 0 ? 0 : Math.max(...parents.map(depth)) + 1;
    visiting.delete(id);
    layer.set(id, v);
    return v;
  };
  for (const id of ids) depth(id);

  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id) ?? 0;
    columns.set(l, [...(columns.get(l) ?? []), id]);
  }
  const maxRows = Math.max(...[...columns.values()].map((c) => c.length), 1);
  const colCount = Math.max(...columns.keys(), 0) + 1;
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y;
  const width = PAD * 2 + colCount * NODE_W + (colCount - 1) * GAP_X;

  const pos = new Map<string, { x: number; y: number }>();
  for (const [l, col] of columns) {
    const colHeight = col.length * NODE_H + (col.length - 1) * GAP_Y;
    const top = PAD + (height - PAD * 2 - colHeight) / 2;
    col.forEach((id, row) => pos.set(id, { x: PAD + l * (NODE_W + GAP_X), y: top + row * (NODE_H + GAP_Y) }));
  }

  const nodes: LaidOutNode[] = d.nodes.map((n) => ({ ...n, ...pos.get(n.id)! }));
  const edges: LaidOutEdge[] = d.edges.flatMap((e) => {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) return [];
    const forward = b.x > a.x;
    return [
      {
        from: e.from,
        to: e.to,
        label: e.label,
        x1: forward ? a.x + NODE_W : a.x + NODE_W / 2,
        y1: forward ? a.y + NODE_H / 2 : a.y + (b.y >= a.y ? NODE_H : 0),
        x2: forward ? b.x : b.x + NODE_W / 2,
        y2: forward ? b.y + NODE_H / 2 : b.y + (b.y >= a.y ? 0 : NODE_H),
      },
    ];
  });
  return { width, height, nodes, edges };
}

/** Accessible text equivalent of the diagram: one line per relationship, plus isolated nodes. */
export function diagramTextAlternative(d: ArchitectureDiagram): string[] {
  const label = new Map(d.nodes.map((n) => [n.id, n.label]));
  const connected = new Set<string>();
  const lines = d.edges.map((e) => {
    connected.add(e.from);
    connected.add(e.to);
    return `${label.get(e.from) ?? e.from} → ${label.get(e.to) ?? e.to}${e.label ? ` (${e.label})` : ""}`;
  });
  for (const n of d.nodes) if (!connected.has(n.id)) lines.push(n.label);
  return lines;
}
