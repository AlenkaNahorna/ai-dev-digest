"use client";

import React from "react";
import { Badge, Button, FormField, Modal, TextInput } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { useExportCi, usePreviewCi } from "../api/hooks";
import type { CiExportResult } from "../model/types";

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const codeBox: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 12,
  lineHeight: 1.5,
  padding: 10,
  margin: 0,
  maxHeight: 220,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  background: "var(--bg-sunken, var(--bg-elevated))",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
};

/** The three Actions config items the member must add themselves (no values shown/requested). */
function SetupChecklist() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
        Before the check runs, add these in the target repo&apos;s GitHub Actions settings:
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
        <li>
          Secret <code>OPENROUTER_API_KEY</code> — your model provider key.
        </li>
        <li>
          Secret <code>DEVDIGEST_INGEST_TOKEN</code> — the one-time token shown below.
        </li>
        <li>
          Variable <code>DEVDIGEST_API_URL</code> — the public base URL of this studio API that GitHub can reach.
        </li>
      </ul>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        DevDigest never reads, requests, or displays any secret value. Making the check <em>required</em> is done by
        you in the repository&apos;s branch-protection rules.
      </div>
    </div>
  );
}

/** One-time ingest token banner. Rendered only right after an export that (re)generated it. */
function IngestTokenBanner({ token }: { token: string }) {
  return (
    <div
      data-testid="ci-ingest-token"
      style={{
        padding: "10px 14px",
        border: "1px solid var(--accent)",
        borderRadius: 8,
        background: "var(--accent-bg, transparent)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--accent)" }}>
        INGEST TOKEN — SHOWN ONCE
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        Copy this now and add it as the Actions Secret <code>DEVDIGEST_INGEST_TOKEN</code>. You will not see it again.
      </div>
      <pre aria-label="Ingest token" style={{ ...codeBox, maxHeight: "none" }}>
        {token}
      </pre>
    </div>
  );
}

/**
 * The ONE "Add to CI" dialog (not a wizard): choose target repo, preview the
 * generated files with contents, confirm. After confirm it shows the opened PR
 * link and the one-time ingest token. Never requests or displays any secret
 * value the member must supply (AC-2, AC-8).
 */
export function CiExportDialog({
  agentId,
  defaultRepo,
  onClose,
}: {
  agentId: string;
  /** Pre-fill the repo picker from the active repo, e.g. "owner/name". */
  defaultRepo?: string;
  onClose: () => void;
}) {
  const [repo, setRepo] = React.useState(defaultRepo ?? "");
  const [preview, setPreview] = React.useState<CiExportResult | null>(null);
  const [opened, setOpened] = React.useState<CiExportResult | null>(null);
  const previewCi = usePreviewCi(agentId);
  const exportCi = useExportCi(agentId);

  const repoValid = REPO_RE.test(repo.trim());
  const pendingError = exportCi.error ?? previewCi.error;
  const errorMessage =
    pendingError instanceof ApiError ? pendingError.message : pendingError ? "Export failed." : null;

  // A new repo edit invalidates a stale preview so the user can't confirm files
  // generated for a different repo.
  const onRepoChange = (v: string) => {
    setRepo(v);
    if (preview) setPreview(null);
  };

  const runPreview = () => {
    if (!repoValid) return;
    previewCi.mutate({ repo: repo.trim() }, { onSuccess: setPreview });
  };
  const confirm = () => {
    if (!repoValid) return;
    exportCi.mutate({ repo: repo.trim() }, { onSuccess: setOpened });
  };

  // After the PR is opened the committed files + token win; otherwise show the preview.
  const shown = opened ?? preview;
  const files = shown?.files ?? [];
  const prUrl = opened?.pr_url ?? null;
  const token = opened?.ingest_token ?? null;

  return (
    <Modal
      width={820}
      title="Add to CI"
      subtitle="Export this agent to a GitHub repository and run it in GitHub Actions on every pull request."
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
          <span style={{ flex: 1 }} />
          <Button kind="ghost" onClick={onClose}>
            {opened ? "Done" : "Cancel"}
          </Button>
          {!opened && !preview && (
            <Button
              kind="secondary"
              icon="Eye"
              disabled={!repoValid || previewCi.isPending}
              loading={previewCi.isPending}
              onClick={runPreview}
            >
              {previewCi.isPending ? "Generating…" : "Preview files"}
            </Button>
          )}
          {!opened && preview && (
            <Button
              kind="primary"
              icon="GitPullRequest"
              disabled={!repoValid || exportCi.isPending}
              loading={exportCi.isPending}
              onClick={confirm}
            >
              {exportCi.isPending ? "Opening PR…" : "Confirm & open PR"}
            </Button>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: 24 }}>
        <FormField label="Target repository" required>
          <TextInput
            value={repo}
            onChange={onRepoChange}
            mono
            placeholder="owner/name"
            aria-label="Target repository"
          />
          {repo.trim() !== "" && !repoValid && (
            <div role="alert" style={{ fontSize: 12, color: "var(--crit)", marginTop: 4 }}>
              Enter a repository as <code>owner/name</code>.
            </div>
          )}
        </FormField>

        {errorMessage && (
          <div role="alert" style={{ fontSize: 13, color: "var(--crit)" }}>
            {errorMessage}
          </div>
        )}

        <SetupChecklist />

        {opened && prUrl && (
          <div style={{ fontSize: 13 }}>
            Pull request opened:{" "}
            <a href={prUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
              {prUrl}
            </a>
          </div>
        )}

        {token && <IngestTokenBanner token={token} />}

        {files.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
              Files {opened ? "committed" : "preview"} ({files.length})
            </div>
            {files.map((f) => (
              <div key={f.path} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <Badge mono icon="FileText">
                  {f.path}
                </Badge>
                <pre style={codeBox}>{f.contents}</pre>
              </div>
            ))}
          </section>
        )}
      </div>
    </Modal>
  );
}
