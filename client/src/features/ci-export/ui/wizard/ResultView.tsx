"use client";

import React from "react";
import type { CiExportResult } from "../../model/types";
import type { InstallMode } from "./InstallStep";
import { codeBox } from "./styles";

/** One-time ingest token banner — rendered only right after an install that (re)generated it. */
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
      <div style={{ fontSize: 12, color: "var(--text-secondary, var(--text-muted))" }}>
        Copy this now and add it as the Actions secret <code>DEVDIGEST_INGEST_TOKEN</code>. You will not see it again.
      </div>
      <pre aria-label="Ingest token" style={{ ...codeBox, maxHeight: "none", borderRadius: 6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {token}
      </pre>
    </div>
  );
}

/** What happens after Install: where the PR/zip is, the one-time token, and the manual follow-ups. */
export function ResultView({
  mode,
  result,
  repo,
  failOn,
}: {
  mode: InstallMode;
  result: CiExportResult;
  repo: string;
  /** Current "Fail CI on" of the agent, for the next-steps note. */
  failOn?: string;
}) {
  const prUrl = result.pr_url;
  const token = result.ingest_token ?? null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {mode === "pr" && prUrl ? (
        <div style={{ fontSize: 13 }}>
          Pull request opened:{" "}
          <a href={prUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
            {prUrl}
          </a>
        </div>
      ) : (
        <div style={{ fontSize: 13 }}>
          Zip downloaded. Unpack it at the root of <code>{repo}</code> on a branch of your own and open a PR.
        </div>
      )}

      {token ? (
        <IngestTokenBanner token={token} />
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          This agent is already installed in <code>{repo}</code>, so its existing ingest token stays valid — nothing new to add.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Next steps</div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
          <li>
            Review the {mode === "pr" ? "PR" : "files"}: <code>permissions</code>, triggers, secret handling and how PR code is executed.
          </li>
          <li>
            In the repo&apos;s Settings → Secrets and variables → Actions add secrets <code>OPENROUTER_API_KEY</code> and{" "}
            <code>DEVDIGEST_INGEST_TOKEN</code> and variable <code>DEVDIGEST_API_URL</code>.
          </li>
          <li>Merge it, then open a test PR in the same repo (not from a fork — fork PRs are skipped).</li>
          <li>
            To block merges, set <strong>Fail CI on</strong>
            {failOn ? ` (now: ${failOn.toUpperCase()})` : ""} and make the check <em>required</em> in branch protection.
          </li>
        </ol>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          DevDigest never reads, requests, or displays any secret value.
        </div>
      </div>
    </div>
  );
}
