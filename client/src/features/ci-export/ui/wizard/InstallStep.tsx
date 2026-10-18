"use client";

import React from "react";
import { Badge, Icon } from "@devdigest/ui";
import { optionCard } from "./styles";

export type InstallMode = "pr" | "zip";

/** Step 4 — Install: open a PR on `devdigest/ci` (never the default branch) or download a zip. */
export function InstallStep({
  mode,
  repo,
  fileCount,
  onMode,
}: {
  mode: InstallMode;
  repo: string;
  fileCount: number;
  onMode: (m: InstallMode) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Install method" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "pr"}
        onClick={() => onMode("pr")}
        style={optionCard(mode === "pr")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon.GitPullRequest size={18} style={{ color: "var(--accent)" }} />
          <span style={{ fontWeight: 600, flex: 1 }}>Open a PR with these files</span>
          <Badge color="var(--accent)">recommended</Badge>
        </div>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          DevDigest commits the {fileCount} generated files to a new <code>devdigest/ci</code> branch in{" "}
          <code>{repo}</code> and opens a pull request. Nothing is written to the default branch.
        </span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "zip"}
        onClick={() => onMode("zip")}
        style={optionCard(mode === "zip")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon.Copy size={18} />
          <span style={{ fontWeight: 600, flex: 1 }}>Copy files as a zip</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>add them manually</span>
        </div>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Downloads a .zip to unpack at the root of <code>{repo}</code>. Nothing is sent to GitHub, but an ingest token is
          still created so results can come back to DevDigest.
        </span>
      </button>
    </div>
  );
}
