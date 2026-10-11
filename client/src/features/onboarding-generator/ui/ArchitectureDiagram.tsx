"use client";
import React from "react";
import type { ArchitectureDiagram as Diagram } from "@devdigest/shared/contracts/onboarding-generator";
import { NODE_H, NODE_W, diagramTextAlternative, layoutDiagram } from "../model/view";

const KIND_COLOR: Record<string, string> = {
  client: "var(--accent-text)",
  service: "var(--ok)",
  module: "var(--text-primary)",
  datastore: "var(--warn)",
  external: "var(--text-muted)",
  other: "var(--text-secondary)",
};

/**
 * Architecture diagram rendered from a typed node/edge graph.
 *
 * Safety: the model never supplies markup. Every label is a React text child
 * (escaped), node/edge geometry is computed here, and nothing is injected via
 * innerHTML or `dangerouslySetInnerHTML`. A text alternative lists the same
 * relationships for screen readers and when the SVG is hard to read.
 */
export function ArchitectureDiagram({ diagram }: { diagram: Diagram }) {
  const layout = React.useMemo(() => layoutDiagram(diagram), [diagram]);
  const lines = React.useMemo(() => diagramTextAlternative(diagram), [diagram]);
  const markerId = React.useId().replace(/:/g, "");

  return (
    <div>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-surface)" }}>
        <svg
          role="img"
          aria-label={`Architecture diagram with ${diagram.nodes.length} components and ${diagram.edges.length} relationships`}
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ display: "block", minWidth: layout.width }}
          data-testid="architecture-diagram"
        >
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
            </marker>
          </defs>
          {layout.edges.map((e, i) => (
            <g key={`${e.from}-${e.to}-${i}`}>
              <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="var(--text-muted)" strokeWidth={1.4} markerEnd={`url(#${markerId})`} />
              {e.label && (
                <text x={(e.x1 + e.x2) / 2} y={(e.y1 + e.y2) / 2 - 5} textAnchor="middle" fontSize={10.5} fill="var(--text-secondary)">
                  {e.label}
                </text>
              )}
            </g>
          ))}
          {layout.nodes.map((n) => (
            <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
              <title>{n.path ? `${n.label} — ${n.path}` : n.label}</title>
              <rect width={NODE_W} height={NODE_H} rx={8} fill="var(--bg-elevated)" stroke={KIND_COLOR[n.kind] ?? "var(--border-strong)"} strokeWidth={1.4} />
              <text x={NODE_W / 2} y={NODE_H / 2 - (n.path ? 3 : -4)} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="var(--text-primary)">
                {n.label}
              </text>
              {n.path && (
                <text x={NODE_W / 2} y={NODE_H / 2 + 11} textAnchor="middle" fontSize={9.5} fill="var(--text-muted)" className="mono">
                  {n.path.length > 26 ? `…${n.path.slice(-25)}` : n.path}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <details style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-secondary)" }}>
        <summary style={{ cursor: "pointer" }}>View diagram as text</summary>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
