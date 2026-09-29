"use client";

import React from "react";
import { AppShell } from "../../components/app-shell";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Modal,
  ProgressBar,
  SelectInput,
  Textarea,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import { useActiveRepo } from "../../lib/repo-context";
import { githubBlobUrl } from "../../lib/github-urls";
import {
  useBuildConventionSkill,
  useConventions,
  useExtractConventions,
  useUpdateConvention,
  CONVENTION_CATEGORIES,
  CONVENTION_RULE_MAX,
  type ConventionCandidate,
  type ConventionPatch,
  type ConventionSkillDraft,
} from "../../lib/hooks/conventions";
import { useCreateSkill, type Skill } from "../../lib/hooks/skills";
import { useToast } from "../../lib/toast";

const SKILL_TYPES: Skill["type"][] = ["rubric", "convention", "security", "custom"];

/** A draft in progress in the "Create skill" modal — the server's draft plus
    the one field it doesn't own (enabled starts on, editable before saving). */
type SkillDraftState = ConventionSkillDraft & { enabled: boolean };

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function ConventionsPage() {
  const { activeRepo, reposLoaded } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;

  const { data, isLoading } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const updateConvention = useUpdateConvention(repoId);
  const buildSkill = useBuildConventionSkill(repoId);
  const createSkill = useCreateSkill();
  const toast = useToast();

  const [draft, setDraft] = React.useState<SkillDraftState | null>(null);

  const candidates = data?.candidates ?? [];
  const acceptedIds = candidates.filter((c) => c.accepted).map((c) => c.id);
  const allAccepted = candidates.length > 0 && acceptedIds.length === candidates.length;
  // A scan can legitimately finish with zero candidates (every draft failed the
  // evidence-gate check against the sampled files) — that's a completed scan,
  // not "never scanned". Distinguish by run_id, not by candidates.length.
  const hasScanned = Boolean(data?.run_id);

  const toggleAll = () => {
    const next = !allAccepted;
    for (const c of candidates) {
      if (c.accepted !== next) updateConvention.mutate({ id: c.id, accepted: next });
    }
  };

  const openCreateSkill = () => {
    if (!repoId || acceptedIds.length === 0) return;
    buildSkill.mutate(acceptedIds, {
      onSuccess: (d) => setDraft({ ...d, enabled: true }),
    });
  };

  const saveSkill = () => {
    if (!draft) return;
    createSkill.mutate(
      {
        name: draft.name,
        description: draft.description,
        type: draft.type,
        body: draft.body,
        source: "extracted",
        enabled: draft.enabled,
      },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success(`Saved “${draft.name}” as v1 · added to Skills Lab`);
        },
      },
    );
  };

  if (reposLoaded && !activeRepo) {
    return (
      <AppShell crumb={[{ label: "Skills Lab" }, { label: "Conventions" }]}>
        <div style={{ padding: 28 }}>
          <EmptyState
            icon="Boxes"
            title="No repository selected"
            body="Add or select a repository first — conventions are extracted per repo."
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: "Skills Lab" }, { label: "Conventions" }]}>
      <div style={{ padding: 28, maxWidth: 960 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>
              Conventions in{" "}
              <span className="mono" style={{ color: "var(--accent-text)" }}>
                {activeRepo?.name}
              </span>
            </h1>
            <p style={{ color: "var(--text-secondary)", marginTop: 4, fontSize: 13.5 }}>
              {hasScanned && data
                ? `Detected from ${data.sample_files_count} sample file${data.sample_files_count === 1 ? "" : "s"} · last scan ${timeAgo(data.scanned_at)}`
                : "No scan yet — analyze this repo to extract its own house conventions."}
            </p>
          </div>
          <Button kind="secondary" icon="RefreshCw" onClick={() => extract.mutate()} loading={extract.isPending}>
            {hasScanned ? "Re-scan" : "Analyze conventions"}
          </Button>
        </div>

        {extract.isError && (
          <p style={{ color: "var(--danger)", marginTop: 14 }}>
            Could not extract conventions.{" "}
            {extract.error instanceof Error ? extract.error.message : "Try again."}
          </p>
        )}

        {candidates.length > 0 && (
          // Sticky so it stays reachable while scrolling a long candidate
          // list — this is the only way to open "Create skill" (the modal's
          // Name/Description fields live inside it), so it must never scroll
          // out of view.
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 5,
              display: "flex",
              alignItems: "center",
              gap: 14,
              margin: "22px 0",
              padding: "10px 0",
              background: "var(--bg-base)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <Button kind="ghost" size="sm" icon={allAccepted ? "X" : "Check"} onClick={toggleAll}>
              {allAccepted ? "Deselect all" : "Select all"}
            </Button>
            <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              {acceptedIds.length} of {candidates.length} accepted
            </span>
            <span style={{ flex: 1 }} />
            <Button
              kind="primary"
              icon="Sparkles"
              onClick={openCreateSkill}
              loading={buildSkill.isPending}
              disabled={acceptedIds.length === 0}
            >
              Create skill
            </Button>
          </div>
        )}
        {buildSkill.isError && (
          <p style={{ color: "var(--danger)", marginBottom: 14 }}>
            {buildSkill.error instanceof Error ? buildSkill.error.message : "Could not build a skill draft."}
          </p>
        )}

        {isLoading ? (
          <div style={{ padding: 60, color: "var(--text-secondary)" }}>Loading…</div>
        ) : candidates.length === 0 ? (
          <EmptyState
            icon="ListChecks"
            title={hasScanned ? "No conventions survived the last scan" : "No conventions detected yet"}
            body={
              hasScanned
                ? `The last scan checked ${data?.sample_files_count ?? 0} sample file${data?.sample_files_count === 1 ? "" : "s"} but every draft convention failed the evidence check (its citation didn't match the real file content) — so nothing was kept. Try re-scanning, or check Settings → Models if this keeps happening with the current model.`
                : "Analyzing samples this repo's config files and its top-ranked source files, then asks a model to propose house conventions — each backed by a real file:line citation."
            }
            cta={extract.isPending ? undefined : hasScanned ? "Re-scan" : "Analyze conventions"}
            onCta={() => extract.mutate()}
            ctaLoading={extract.isPending}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                repoFullName={activeRepo?.full_name ?? ""}
                sha={activeRepo?.default_branch ?? "HEAD"}
                pending={updateConvention.isPending}
                onAccept={() => updateConvention.mutate({ id: c.id, accepted: true })}
                onReject={() => updateConvention.mutate({ id: c.id, accepted: false })}
                onSaveEdit={(patch, done) =>
                  updateConvention.mutate({ id: c.id, ...patch }, { onSuccess: done })
                }
                editError={
                  updateConvention.isError && updateConvention.variables?.id === c.id
                    ? updateConvention.error instanceof Error
                      ? updateConvention.error.message
                      : "Could not save the change."
                    : null
                }
              />
            ))}
          </div>
        )}
      </div>

      {draft && (
        <CreateSkillModal
          draft={draft}
          setDraft={setDraft}
          onCancel={() => setDraft(null)}
          onSave={saveSkill}
          saving={createSkill.isPending}
          error={createSkill.error}
        />
      )}
    </AppShell>
  );
}

function CandidateCard({
  candidate,
  repoFullName,
  sha,
  onAccept,
  onReject,
  onSaveEdit,
  editError,
  pending,
}: {
  candidate: ConventionCandidate;
  repoFullName: string;
  sha: string;
  onAccept: () => void;
  onReject: () => void;
  /** Save an edited rule/category; call `done` once the save succeeded to leave edit mode. */
  onSaveEdit: (patch: Pick<ConventionPatch, "rule" | "category">, done: () => void) => void;
  editError: string | null;
  pending: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [ruleDraft, setRuleDraft] = React.useState(candidate.rule);
  const [categoryDraft, setCategoryDraft] = React.useState<ConventionCandidate["category"]>(candidate.category);
  const trimmedRule = ruleDraft.trim();
  const unchanged = trimmedRule === candidate.rule && categoryDraft === candidate.category;
  const canSave = trimmedRule.length > 0 && ruleDraft.length <= CONVENTION_RULE_MAX && !unchanged && !pending;

  const startEdit = () => {
    setRuleDraft(candidate.rule);
    setCategoryDraft(candidate.category);
    setEditing(true);
  };
  const saveEdit = () =>
    onSaveEdit({ rule: trimmedRule, category: categoryDraft }, () => setEditing(false));

  const rangeLabel =
    candidate.evidence_line_end > candidate.evidence_line_start
      ? `${candidate.evidence_path}:${candidate.evidence_line_start}-${candidate.evidence_line_end}`
      : `${candidate.evidence_path}:${candidate.evidence_line_start}`;
  const evidenceUrl = repoFullName
    ? githubBlobUrl(
        repoFullName,
        sha,
        candidate.evidence_path,
        candidate.evidence_line_start,
        candidate.evidence_line_end,
      )
    : undefined;
  const pct = Math.round(candidate.confidence * 100);
  const barColor = pct >= 85 ? "var(--ok)" : pct >= 65 ? "var(--warn)" : "var(--text-muted)";

  return (
    <Card style={{ borderLeft: `3px solid ${candidate.accepted ? "var(--ok)" : "var(--border)"}` }}>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <FormField
                label="Rule"
                hint={`${ruleDraft.length}/${CONVENTION_RULE_MAX}`}
              >
                <Textarea value={ruleDraft} onChange={setRuleDraft} rows={3} />
              </FormField>
              <FormField label="Category">
                <SelectInput
                  value={categoryDraft}
                  options={CONVENTION_CATEGORIES}
                  onChange={(v) => setCategoryDraft(v as ConventionCandidate["category"])}
                />
              </FormField>
              {editError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{editError}</p>}
              <div style={{ display: "flex", gap: 8 }}>
                <Button kind="primary" size="sm" icon="Check" onClick={saveEdit} disabled={!canSave}>
                  Save
                </Button>
                <Button kind="secondary" size="sm" onClick={() => setEditing(false)} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{candidate.rule}</div>
              <Badge mono>{candidate.category}</Badge>
            </div>
          )}

          {evidenceUrl ? (
            <a
              href={evidenceUrl}
              target="_blank"
              rel="noreferrer"
              className="mono"
              style={{ fontSize: 12.5, color: "var(--text-secondary)", display: "inline-block", marginTop: 10 }}
            >
              {rangeLabel}
            </a>
          ) : (
            <div className="mono" style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 10 }}>
              {rangeLabel}
            </div>
          )}

          <pre
            className="mono"
            style={{
              marginTop: 8,
              padding: 12,
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12.5,
              overflow: "auto",
              whiteSpace: "pre",
            }}
          >
            {candidate.evidence_snippet}
          </pre>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", width: 72, flexShrink: 0 }}>Confidence</span>
            <div style={{ flex: 1, maxWidth: 220 }}>
              <ProgressBar value={pct} color={barColor} />
            </div>
            <span className="mono tnum" style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {pct}%
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 116, flexShrink: 0 }}>
          {/* Accept is the call-to-action while pending (blue); once accepted
              it settles into a plain "done" label, never Reject — Reject is
              always a secondary, available action, never highlighted. */}
          <Button
            kind={candidate.accepted ? "secondary" : "primary"}
            size="sm"
            icon="Check"
            onClick={onAccept}
            disabled={pending || editing || candidate.accepted}
          >
            {candidate.accepted ? "Accepted" : "Accept"}
          </Button>
          <Button kind="secondary" size="sm" icon="Edit" onClick={startEdit} disabled={pending || editing}>
            Edit
          </Button>
          <Button
            kind="secondary"
            size="sm"
            icon="X"
            onClick={onReject}
            disabled={pending || editing}
          >
            Reject
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CreateSkillModal({
  draft,
  setDraft,
  onCancel,
  onSave,
  saving,
  error,
}: {
  draft: SkillDraftState;
  setDraft: (d: SkillDraftState) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: unknown;
}) {
  const errorMessage = error ? (error instanceof Error ? error.message : String(error)) : null;
  const fileCount = draft.evidence_files.length;

  return (
    <Modal
      width={760}
      title="Create skill from conventions"
      subtitle={draft.name}
      onClose={onCancel}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1 }}>
            Will be saved as v1 · added to Skills Lab
          </span>
          <Button kind="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={onSave} disabled={!draft.name || !draft.body || saving}>
            {saving ? "Saving…" : "Create skill"}
          </Button>
        </div>
      }
    >
      <div style={{ padding: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "12px 14px",
            marginBottom: 20,
            borderRadius: 8,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          Merged from {fileCount} accepted convention{fileCount === 1 ? "" : "s"}. Everything below is editable
          before you save.
        </div>

        <FormField label="Name" required>
          <TextInput value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
        </FormField>
        <FormField label="Description">
          <TextInput value={draft.description} onChange={(description) => setDraft({ ...draft, description })} />
        </FormField>

        <div style={{ display: "flex", gap: 20 }}>
          <div style={{ flex: 1 }}>
            <FormField label="Type">
              <SelectInput
                value={draft.type}
                options={SKILL_TYPES}
                onChange={(type) => setDraft({ ...draft, type: type as Skill["type"] })}
              />
            </FormField>
          </div>
          <div style={{ flex: 1 }}>
            <FormField label="Enabled" hint="Whether this skill is added to agents' prompts.">
              <Toggle on={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
            </FormField>
          </div>
        </div>

        <FormField
          label={`Skill body (~${Math.max(1, Math.ceil(draft.body.length / 4))} tokens)`}
          hint="Markdown is appended to the agent's prompt when this skill is enabled and linked."
        >
          <Textarea value={draft.body} onChange={(body) => setDraft({ ...draft, body })} rows={18} mono />
        </FormField>

        {errorMessage && (
          <p style={{ color: "var(--danger)", marginTop: 10 }}>Could not save skill. {errorMessage}</p>
        )}
      </div>
    </Modal>
  );
}
