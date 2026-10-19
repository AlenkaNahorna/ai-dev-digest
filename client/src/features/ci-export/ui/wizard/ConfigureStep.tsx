"use client";

import React from "react";
import { Badge, Checkbox, Icon } from "@devdigest/ui";
import { sectionLabel } from "./styles";

export type PostAs = "github_review" | "pr_comment" | "none";

const POST_AS_OPTIONS: { value: PostAs; label: string; hint: string; recommended?: boolean }[] = [
  { value: "github_review", label: "GitHub review", hint: "Summary + inline comments as a PR review", recommended: true },
  { value: "pr_comment", label: "PR comment", hint: "One summary comment, no inline anchors" },
  { value: "none", label: "None (exit code only)", hint: "Nothing is posted; the check just passes or fails" },
];

/** Secrets/variables the member adds themselves. Only NAMES — values are never read or requested. */
const SECRETS: { name: string; note: string; badge: string; ready?: boolean }[] = [
  { name: "OPENROUTER_API_KEY", note: "Your OpenRouter key — add as an Actions secret", badge: "add manually" },
  { name: "DEVDIGEST_INGEST_TOKEN", note: "One-time token, shown after install — add as an Actions secret", badge: "after install" },
  { name: "DEVDIGEST_API_URL", note: "Public base URL of this DevDigest API (Actions variable)", badge: "add manually" },
  { name: "GITHUB_TOKEN", note: "Auto-provided by Actions", badge: "ready", ready: true },
];

/**
 * Step 3 — Configure. `pull_request` activity types (`opened` + `synchronize`
 * always on, `reopened` optional) and how the result is published.
 */
export function ConfigureStep({
  reopened,
  postAs,
  workflowEdited,
  onReopened,
  onPostAs,
}: {
  reopened: boolean;
  postAs: PostAs;
  /** True when the member edited the workflow in Preview — changing options resets it. */
  workflowEdited: boolean;
  onReopened: (v: boolean) => void;
  onPostAs: (v: PostAs) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={sectionLabel}>Trigger</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Checkbox checked disabled label={<code>pull_request:opened</code>} ariaLabel="pull_request opened" />
          <Checkbox checked disabled label={<code>pull_request:synchronize</code>} ariaLabel="pull_request synchronize" />
          <Checkbox
            checked={reopened}
            onChange={onReopened}
            label={<code>pull_request:reopened</code>}
            ariaLabel="pull_request reopened"
          />
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={sectionLabel}>Secrets expected</div>
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            border: "1px solid var(--border-strong)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {SECRETS.map((s, i) => (
            <li
              key={s.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <code style={{ fontSize: 12, fontWeight: 600, minWidth: 190 }}>{s.name}</code>
              <span style={{ flex: 1, fontSize: 12, color: "var(--text-muted)" }}>{s.note}</span>
              <Badge color={s.ready ? "var(--ok)" : "var(--warn, var(--accent))"}>{s.badge}</Badge>
            </li>
          ))}
        </ul>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Add these in the repo&apos;s Settings → Secrets and variables → Actions before the workflow runs. DevDigest never
          reads or displays a secret value.
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={sectionLabel}>Post results as</div>
        <div role="radiogroup" aria-label="Post results as" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {POST_AS_OPTIONS.map((o) => (
            <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
              <input
                type="radio"
                name="post-as"
                value={o.value}
                checked={postAs === o.value}
                onChange={() => onPostAs(o.value)}
              />
              <span style={{ fontWeight: 500 }}>{o.label}</span>
              {o.recommended && <Badge color="var(--accent)">recommended</Badge>}
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{o.hint}</span>
            </label>
          ))}
        </div>
      </section>

      {workflowEdited && (
        <div role="status" style={{ fontSize: 12, color: "var(--warn, var(--accent))" }}>
          You edited the workflow in Preview. Changing these options regenerates it and resets your edits.
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 10,
          padding: "12px 14px",
          border: "1px solid var(--border-strong)",
          borderRadius: 10,
          fontSize: 12,
          color: "var(--text-secondary, var(--text-muted))",
          lineHeight: 1.5,
        }}
      >
        <Icon.Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          To block merges: set <strong>Fail CI on</strong> (CI tab) so the run exits non-zero, then add a{" "}
          <strong>required status check</strong> in the repo&apos;s branch protection / ruleset. No GitHub App needed.
        </span>
      </div>
    </div>
  );
}
