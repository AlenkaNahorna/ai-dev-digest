"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

export type Skill = {
  id: string; name: string; description: string;
  type: "rubric" | "convention" | "security" | "custom";
  source: "manual" | "imported_url" | "extracted" | "community";
  body: string; enabled: boolean; version: number;
  evidence_files?: string[] | null;
};
export type AgentSkillLink = { agent_id: string; skill_id: string; order: number; enabled: boolean; skill?: Skill };
export type SkillImportInput = { filename: string; content: string; name?: string; description?: string; type?: Skill["type"] };
export type SkillImportPreview = { filename: string; name: string; description: string; type: Skill["type"]; source: Skill["source"]; body: string; executable_files_ignored: string[] };
export function useSkills() { return useQuery({ queryKey: ["skills"], queryFn: () => api.get<Skill[]>("/skills") }); }
export function useSkill(id: string | null) { return useQuery({ queryKey: ["skill", id], queryFn: () => api.get<Skill>(`/skills/${id}`), enabled: !!id }); }
export function useSkillVersions(id: string | null) { return useQuery({ queryKey: ["skill-versions", id], queryFn: () => api.get<Array<{ skill_id: string; version: number; body: string; created_at: string }>>(`/skills/${id}/versions`), enabled: !!id }); }
export function useSkillImportPreview() { return useMutation({ mutationFn: (input: SkillImportInput) => api.post<SkillImportPreview>("/skills/import/preview", input) }); }
export function useImportSkill() { const qc = useQueryClient(); return useMutation({ mutationFn: (input: SkillImportInput) => api.post<Skill>("/skills/import", input), onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }) }); }
export function useCreateSkill() { const qc = useQueryClient(); return useMutation({ mutationFn: (input: Omit<Skill, "id" | "version" | "evidence_files">) => api.post<Skill>("/skills", input), onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }) }); }
export function useUpdateSkill() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: Partial<Skill> }) => api.put<Skill>(`/skills/${id}`, patch), onSuccess: (data) => { qc.invalidateQueries({ queryKey: ["skills"] }); qc.setQueryData(["skill", data.id], data); qc.invalidateQueries({ queryKey: ["skill-versions", data.id] }); } }); }
export function useSkillLinks(agentId: string | null) { return useQuery({ queryKey: ["agent-skills", agentId], queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`), enabled: !!agentId }); }
export function useSetSkillLinks() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ agentId, skills }: { agentId: string; skills: AgentSkillLink[] }) => api.put<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skills: skills.map(({ skill_id, order, enabled }) => ({ skill_id, order, enabled })) }), onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ["agent-skills", vars.agentId] }); qc.invalidateQueries({ queryKey: ["agent", vars.agentId] }); } }); }
