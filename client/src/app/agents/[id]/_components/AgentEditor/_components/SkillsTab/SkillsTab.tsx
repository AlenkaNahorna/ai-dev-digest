"use client";

import React from "react";
import { Badge, Checkbox, TextInput } from "@devdigest/ui";
import { useSetSkillLinks, useSkillLinks, useSkills, type AgentSkillLink } from "../../../../../../../lib/hooks/skills";

export function SkillsTab({ agentId }: { agentId: string }) {
  const { data: skills = [] } = useSkills();
  const { data: links = [], isLoading } = useSkillLinks(agentId);
  const save = useSetSkillLinks();
  const [filter, setFilter] = React.useState("");
  const [dragged, setDragged] = React.useState<string | null>(null);
  const linked = new Map(links.map((l) => [l.skill_id, l]));
  const orderedLinks = [...links].sort((a, b) => a.order - b.order);
  const rows = [...orderedLinks.map((l) => skills.find((s) => s.id === l.skill_id)).filter(Boolean), ...skills.filter((s) => !linked.has(s.id))]
    .filter((skill) => `${skill!.name} ${skill!.description}`.toLowerCase().includes(filter.toLowerCase())) as typeof skills;
  const commit = (next: AgentSkillLink[]) => save.mutate({ agentId, skills: next.map((x, i) => ({ ...x, order: i })) });
  const toggle = (skillId: string, enabled: boolean) => { const current = linked.get(skillId); if (current) commit(orderedLinks.map((x) => x.skill_id === skillId ? { ...x, enabled } : x)); else commit([...orderedLinks, { agent_id: agentId, skill_id: skillId, order: orderedLinks.length, enabled: true }]); };
  const drop = (targetId: string) => { if (!dragged || dragged === targetId) return; const current = linked.get(dragged); if (!current) return; const next = [...orderedLinks]; const from = next.findIndex((x) => x.skill_id === dragged); const to = next.findIndex((x) => x.skill_id === targetId); if (from < 0 || to < 0) return; const [item] = next.splice(from, 1); next.splice(to, 0, item!); commit(next); setDragged(null); };
  const enabledCount = orderedLinks.filter((l) => l.enabled).length;
  return <div><div style={{ display: "flex", alignItems: "center", gap: 14 }}><h2 style={{ flex: 1 }}>Skills <Badge color="var(--accent-text)" mono>{enabledCount} of {orderedLinks.length} enabled</Badge></h2><TextInput value={filter} onChange={setFilter} placeholder="Filter skills…" /></div><p style={{ color: "var(--text-secondary)", margin: "14px 0 18px" }}>Order matters — drag to reorder. Earlier skills appear earlier in the assembled prompt.</p>{save.isError && <p style={{ color: "var(--danger)", marginBottom: 10 }}>Could not save skill changes. Try again.</p>}{isLoading ? <p>Loading…</p> : rows.map((skill) => { const link = linked.get(skill.id); const active = !!link; return <div key={skill.id} draggable={active && !save.isPending} onDragStart={() => setDragged(skill.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(skill.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, background: active ? "var(--bg-elevated)" : "transparent", opacity: active && !link.enabled ? 0.55 : 1 }}><span title={active ? "Drag to reorder" : "Attach to agent"} style={{ color: "var(--text-muted)", cursor: active ? "grab" : "default", fontSize: 18 }}>⠿</span><Checkbox ariaLabel={`Toggle ${skill.name} skill`} checked={!!link?.enabled} disabled={save.isPending} onChange={(enabled) => toggle(skill.id, enabled)} /><strong style={{ flex: 1, fontFamily: "var(--font-mono)" }}>{skill.name}</strong><Badge color="var(--accent-text)" mono>{skill.type}</Badge>{active && <span style={{ color: "var(--text-muted)", fontSize: 12 }}>#{link.order + 1}</span>}</div>; })}</div>;
}
