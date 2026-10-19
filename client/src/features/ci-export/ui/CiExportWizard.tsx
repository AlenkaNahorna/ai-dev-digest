"use client";

import React from "react";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { CiExportInputBody, CiFile } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useExportCi, usePreviewCi } from "../api/hooks";
import { downloadBlob, buildZip } from "../lib/zip";
import type { CiExportResult } from "../model/types";
import { ConfigureStep, type PostAs } from "./wizard/ConfigureStep";
import { InstallStep, type InstallMode } from "./wizard/InstallStep";
import { PreviewStep, WORKFLOW_PATH } from "./wizard/PreviewStep";
import { ResultView } from "./wizard/ResultView";
import { TargetStep } from "./wizard/TargetStep";

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const STEP_LABELS = ["Target", "Preview", "Configure", "Install"];
const LAST_STEP = STEP_LABELS.length - 1;

interface Config {
  reopened: boolean;
  postAs: PostAs;
  edits: Record<string, string>;
}

/**
 * Export wizard: Target → Preview → Configure → Install.
 *
 * - Preview/Configure only ever call `action: "files"` (no GitHub write, nothing
 *   persisted). The preview is regenerated whenever the repo or a Configure
 *   choice changes so the shown workflow always equals what Install commits.
 * - Install either opens/reuses the `devdigest/ci` PR (`action: "open_pr"`,
 *   never the default branch) or persists the installation and downloads a zip
 *   (`action: "zip"`). The one-time ingest token is shown only on the result view.
 * - The wizard never requests or shows a secret value.
 */
export function CiExportWizard({
  agentId,
  agentName,
  defaultRepo,
  failOn,
  onClose,
}: {
  agentId: string;
  agentName?: string;
  /** Pre-fill the repo from the active repo / the installation being updated. */
  defaultRepo?: string;
  /** The agent's current "Fail CI on", echoed in the next steps. */
  failOn?: string;
  onClose: () => void;
}) {
  const [step, setStep] = React.useState(0);
  const [repo, setRepo] = React.useState(defaultRepo ?? "");
  const [config, setConfig] = React.useState<Config>({ reopened: false, postAs: "github_review", edits: {} });
  const [files, setFiles] = React.useState<CiFile[] | null>(null);
  const [mode, setMode] = React.useState<InstallMode>("pr");
  const [result, setResult] = React.useState<CiExportResult | null>(null);

  const previewCi = usePreviewCi(agentId);
  const exportCi = useExportCi(agentId);

  // Guards against an older preview response overwriting a newer one.
  const previewSeq = React.useRef(0);
  const previewedRepo = React.useRef<string | null>(null);

  const repoValid = REPO_RE.test(repo.trim());
  const pendingError = exportCi.error ?? previewCi.error;
  const errorMessage =
    pendingError instanceof ApiError ? pendingError.message : pendingError ? "Export failed." : null;

  const buildInput = (action: "files" | "open_pr" | "zip", c: Config): CiExportInputBody => ({
    repo: repo.trim(),
    target: "gha",
    action,
    post_as: c.postAs,
    triggers: c.reopened ? ["opened", "synchronize", "reopened"] : ["opened", "synchronize"],
    overrides: c.edits,
  });

  const loadPreview = (c: Config) => {
    const seq = ++previewSeq.current;
    previewedRepo.current = repo.trim();
    previewCi.mutate(buildInput("files", c), {
      onSuccess: (res) => {
        if (seq === previewSeq.current) setFiles(res.files);
      },
    });
  };

  const changeRepo = (v: string) => {
    setRepo(v);
    // Generated memory/manifest depend on the repo: a stale preview must not be confirmable.
    setFiles(null);
    previewedRepo.current = null;
  };

  /** Configure change: regenerates the workflow, so edits to it are dropped. */
  const changeConfig = (patch: Partial<Pick<Config, "reopened" | "postAs">>) => {
    const { [WORKFLOW_PATH]: _dropped, ...rest } = config.edits;
    const next: Config = { ...config, ...patch, edits: rest };
    setConfig(next);
    loadPreview(next);
  };

  const editFile = (path: string, contents: string) =>
    setConfig((c) => ({ ...c, edits: { ...c.edits, [path]: contents } }));
  const resetFile = (path: string) =>
    setConfig((c) => {
      const { [path]: _removed, ...rest } = c.edits;
      return { ...c, edits: rest };
    });

  const goNext = () => {
    if (step === 0) {
      if (!repoValid) return;
      if (!files || previewedRepo.current !== repo.trim()) loadPreview(config);
    }
    setStep((s) => Math.min(s + 1, LAST_STEP));
  };

  const install = () => {
    if (!repoValid) return;
    const action = mode === "pr" ? "open_pr" : "zip";
    exportCi.mutate(buildInput(action, config), {
      onSuccess: (res) => {
        if (mode === "zip") downloadBlob(buildZip(res.files), "devdigest-ci.zip");
        setResult(res);
      },
    });
  };

  const nextDisabled = step === 0 ? !repoValid : step === 1 ? !files || previewCi.isPending : false;
  const fileCount = files?.length ?? 0;

  const footer = result ? (
    <div style={{ display: "flex", width: "100%" }}>
      <span style={{ flex: 1 }} />
      <Button kind="primary" onClick={onClose}>
        Done
      </Button>
    </div>
  ) : (
    <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
      {step > 0 ? (
        <Button kind="secondary" icon="ChevronLeft" onClick={() => setStep((s) => s - 1)} disabled={exportCi.isPending}>
          Back
        </Button>
      ) : (
        <Button kind="ghost" onClick={onClose}>
          Cancel
        </Button>
      )}
      <span style={{ flex: 1 }} />
      {step < LAST_STEP ? (
        <Button kind="primary" iconRight="ArrowRight" disabled={nextDisabled} onClick={goNext}>
          Continue
        </Button>
      ) : (
        <Button
          kind="primary"
          icon="Check"
          disabled={!repoValid || !files || exportCi.isPending}
          loading={exportCi.isPending}
          onClick={install}
        >
          {exportCi.isPending ? (mode === "pr" ? "Opening PR…" : "Preparing zip…") : "Install"}
        </Button>
      )}
    </div>
  );

  return (
    <Modal
      width={860}
      title="Export to CI"
      subtitle={`Run ${agentName ?? "this agent"} automatically on pull requests`}
      onClose={onClose}
      footer={footer}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: 24 }}>
        {!result && <ExportWizardSteps step={step} labels={STEP_LABELS} />}

        {errorMessage && (
          <div role="alert" style={{ fontSize: 13, color: "var(--crit)" }}>
            {errorMessage}
          </div>
        )}

        {result ? (
          <ResultView mode={mode} result={result} repo={repo.trim()} failOn={failOn} />
        ) : step === 0 ? (
          <TargetStep repo={repo} repoValid={repoValid} onRepo={changeRepo} />
        ) : step === 1 ? (
          <PreviewStep
            files={files}
            loading={previewCi.isPending}
            edits={config.edits}
            onEdit={editFile}
            onReset={resetFile}
          />
        ) : step === 2 ? (
          <ConfigureStep
            reopened={config.reopened}
            postAs={config.postAs}
            workflowEdited={config.edits[WORKFLOW_PATH] !== undefined}
            onReopened={(reopened) => changeConfig({ reopened })}
            onPostAs={(postAs) => changeConfig({ postAs })}
          />
        ) : (
          <InstallStep mode={mode} repo={repo.trim()} fileCount={fileCount} onMode={setMode} />
        )}
      </div>
    </Modal>
  );
}
