"use client";

import React from "react";
import { Badge, FormField, Icon, TextInput } from "@devdigest/ui";
import { optionCard, sectionLabel } from "./styles";

/**
 * Step 1 — Target. GitHub Actions is the only target with a real generator, so it
 * is the only one offered: CircleCI / Jenkins / Generic CLI are NOT shown as
 * choices because picking one would have nothing to generate. The repository
 * (`owner/name`) is chosen here and pre-filled from the active repo.
 */
export function TargetStep({
  repo,
  repoValid,
  onRepo,
}: {
  repo: string;
  repoValid: boolean;
  onRepo: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={sectionLabel}>CI target</div>
        <button type="button" role="radio" aria-checked="true" style={optionCard(true)}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon.GitBranch size={18} style={{ color: "var(--accent)" }} />
            <span style={{ fontWeight: 600, flex: 1 }}>GitHub Actions</span>
            <Badge color="var(--accent)">recommended</Badge>
          </div>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Runs on pull_request events</span>
        </button>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          CircleCI, Jenkins and a generic CLI export aren&apos;t available yet.
        </div>
      </div>

      <FormField label="Target repository" required>
        <TextInput value={repo} onChange={onRepo} mono placeholder="owner/name" aria-label="Target repository" />
        {repo.trim() !== "" && !repoValid && (
          <div role="alert" style={{ fontSize: 12, color: "var(--crit)", marginTop: 4 }}>
            Enter a repository as <code>owner/name</code>.
          </div>
        )}
      </FormField>
    </div>
  );
}
