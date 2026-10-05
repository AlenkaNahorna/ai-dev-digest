"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastRadius } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { buildGraph, type GraphNode } from "./graph";
import { chipTone, s } from "./styles";

export interface BlastGraphProps {
  data: BlastRadius;
  repoFullName: string | null;
  headSha: string;
}

const NODE_TONE = {
  symbol: { stroke: chipTone.endpoint.color, fill: "var(--bg-hover)", text: "var(--text-primary)" },
  caller: { stroke: "var(--text-tertiary)", fill: "var(--bg-elevated)", text: "var(--text-secondary)" },
  endpoint: { stroke: chipTone.endpoint.color, fill: chipTone.endpoint.bg, text: chipTone.endpoint.color },
  cron: { stroke: chipTone.cron.color, fill: chipTone.cron.bg, text: chipTone.cron.color },
} as const;

/** Graph view: changed symbol -> callers -> endpoints and crons, drawn as SVG (no chart library). */
export function BlastGraph({ data, repoFullName, headSha }: BlastGraphProps) {
  const t = useTranslations("blast");
  const layout = React.useMemo(() => buildGraph(data), [data]);
  if (layout.nodes.length === 0) return <div style={s.muted}>{t("graph.empty")}</div>;

  const drawNode = (n: GraphNode) => {
    const tone = NODE_TONE[n.kind];
    const box = (
      <g>
        <title>{n.title}</title>
        <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={8} fill={tone.fill} stroke={tone.stroke} strokeWidth={n.kind === "caller" ? 1 : 1.5} />
        <text x={n.x + n.width / 2} y={n.y + n.height / 2} textAnchor="middle" dominantBaseline="central" fontSize={12} fill={tone.text} style={{ fontFamily: "var(--font-mono, monospace)" }}>
          {n.label}
        </text>
      </g>
    );
    if (n.kind === "caller" && repoFullName && n.file && n.line != null) {
      return (
        <a key={n.id} href={githubBlobUrl(repoFullName, headSha, n.file, n.line)} target="_blank" rel="noopener noreferrer">
          {box}
        </a>
      );
    }
    return <React.Fragment key={n.id}>{box}</React.Fragment>;
  };

  return (
    <div style={s.graphWrap}>
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={t("graph.ariaLabel")} style={s.graphSvg}>
        {layout.edges.map((e) => (
          <path key={e.id} d={e.d} fill="none" stroke="var(--text-tertiary)" strokeOpacity={0.4} strokeWidth={1.2} />
        ))}
        {layout.nodes.map(drawNode)}
      </svg>
      <div style={s.legend}>
        <span style={s.legendItem}><span style={s.legendDot(NODE_TONE.symbol.stroke)} />{t("graph.legend.symbol")}</span>
        <span style={s.legendItem}><span style={s.legendDot("var(--text-secondary)")} />{t("graph.legend.callers")}</span>
        <span style={s.legendItem}><span style={s.legendDot(NODE_TONE.endpoint.stroke)} />{t("graph.legend.endpoints")}</span>
        <span style={s.legendItem}><span style={s.legendDot(NODE_TONE.cron.stroke)} />{t("graph.legend.crons")}</span>
      </div>
    </div>
  );
}
