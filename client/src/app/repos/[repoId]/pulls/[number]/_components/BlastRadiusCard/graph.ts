import type { BlastRadius } from "@devdigest/shared";

export type GraphNodeKind = "symbol" | "caller" | "endpoint" | "cron";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  /** Text drawn inside the node, truncated to fit. */
  label: string;
  /** Full text for the tooltip. */
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Set for caller nodes so the view can link to the line on GitHub. */
  file?: string;
  line?: number;
}

export interface GraphEdge {
  id: string;
  /** SVG cubic Bezier path from the right edge of the source to the left edge of the target. */
  d: string;
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const NODE_HEIGHT = 30;
const ROW_GAP = 14;
const COL_GAP = 70;
const COL_WIDTHS = [150, 170, 210] as const;
const CHAR_WIDTH = 7.2;

export function truncate(text: string, width: number): string {
  const max = Math.max(4, Math.floor((width - 20) / CHAR_WIDTH));
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}

/**
 * Three columns: changed symbol -> its callers -> the endpoints and crons they can reach.
 * The contract groups endpoints and crons per changed symbol (not per caller), so every
 * caller of a symbol is joined to every endpoint/cron of that same symbol. Pure: no DOM.
 */
export function buildGraph(data: BlastRadius): GraphLayout {
  // Callers are grouped by symbol name, so same-named symbols from different files share one group.
  const names = [...new Set(data.changed_symbols.map((sym) => sym.name))];
  const groups = names
    .map((name) => data.downstream.find((d) => d.symbol === name))
    .filter((d): d is NonNullable<typeof d> => d !== undefined && d.callers.length > 0);

  const symbols: GraphNode[] = [];
  const callers = new Map<string, GraphNode>();
  const targets = new Map<string, GraphNode>();
  const links: Array<[string, string]> = [];
  const seenLinks = new Set<string>();
  const link = (from: string, to: string) => {
    const key = `${from}>${to}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    links.push([from, to]);
  };
  const blank = { x: 0, y: 0, height: NODE_HEIGHT } as const;

  for (const g of groups) {
    const symId = `s:${g.symbol}`;
    symbols.push({ id: symId, kind: "symbol", label: truncate(`${g.symbol}()`, COL_WIDTHS[0]), title: g.symbol, width: COL_WIDTHS[0], ...blank });
    for (const c of g.callers) {
      const id = `c:${c.file}:${c.name}`;
      if (!callers.has(id)) {
        callers.set(id, { id, kind: "caller", label: truncate(c.name, COL_WIDTHS[1]), title: `${c.name} ${c.file}:${c.line}`, width: COL_WIDTHS[1], file: c.file, line: c.line, ...blank });
      }
      link(symId, id);
      for (const e of g.endpoints_affected) link(id, `e:${e}`);
      for (const k of g.crons_affected) link(id, `k:${k}`);
    }
    for (const e of g.endpoints_affected) {
      if (!targets.has(`e:${e}`)) targets.set(`e:${e}`, { id: `e:${e}`, kind: "endpoint", label: truncate(e, COL_WIDTHS[2]), title: e, width: COL_WIDTHS[2], ...blank });
    }
    for (const k of g.crons_affected) {
      if (!targets.has(`k:${k}`)) targets.set(`k:${k}`, { id: `k:${k}`, kind: "cron", label: truncate(k, COL_WIDTHS[2]), title: k, width: COL_WIDTHS[2], ...blank });
    }
  }

  const columns = [symbols, [...callers.values()], [...targets.values()]];
  const tallest = Math.max(0, ...columns.map((c) => c.length));
  const height = tallest === 0 ? 0 : tallest * NODE_HEIGHT + (tallest - 1) * ROW_GAP;
  const width = COL_WIDTHS.reduce((a, b) => a + b, 0) + COL_GAP * 2;

  let x = 0;
  columns.forEach((col, i) => {
    const colHeight = col.length * NODE_HEIGHT + Math.max(0, col.length - 1) * ROW_GAP;
    const top = (height - colHeight) / 2;
    col.forEach((n, row) => {
      n.x = x;
      n.y = top + row * (NODE_HEIGHT + ROW_GAP);
    });
    x += COL_WIDTHS[i]! + COL_GAP;
  });

  const nodes = columns.flat();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdge[] = [];
  for (const [from, to] of links) {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) continue;
    const x1 = a.x + a.width;
    const y1 = a.y + a.height / 2;
    const x2 = b.x;
    const y2 = b.y + b.height / 2;
    const mid = (x1 + x2) / 2;
    edges.push({ id: `${from}>${to}`, d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}` });
  }
  return { width, height, nodes, edges };
}
