"use client";

import React from "react";
import { Badge, Button, Icon, Skeleton } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { formatBytes } from "../../lib/format";
import { codeBox, sectionLabel } from "./styles";

export const RUNNER_PATH = ".devdigest/runner/index.js";
export const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";

/**
 * Step 2 — Preview. Left: files that will be created; right: the selected file.
 * Only the workflow is editable (edits are sent back as `overrides`); manifest,
 * skills and memory are authored in the studio, and the minified runner bundle is
 * listed with its size but not rendered.
 */
export function PreviewStep({
  files,
  loading,
  edits,
  onEdit,
  onReset,
}: {
  files: CiFile[] | null;
  loading: boolean;
  edits: Record<string, string>;
  onEdit: (path: string, contents: string) => void;
  onReset: (path: string) => void;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);

  const list = files ?? [];
  const current = list.find((f) => f.path === selected) ?? list.find((f) => f.path === WORKFLOW_PATH) ?? list[0];
  const contents = current ? (edits[current.path] ?? current.contents) : "";
  const isRunner = current?.path === RUNNER_PATH;
  const dirty = current ? edits[current.path] !== undefined : false;

  if (loading && !files) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton height={24} width={220} />
        <Skeleton height={240} />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        border: "1px solid var(--border-strong)",
        borderRadius: 10,
        overflow: "hidden",
        minHeight: 320,
        opacity: loading ? 0.6 : 1,
      }}
    >
      <nav
        aria-label="Files to create"
        style={{ width: 260, flexShrink: 0, borderRight: "1px solid var(--border)", padding: 12, overflow: "auto" }}
      >
        <div style={{ ...sectionLabel, padding: "2px 6px 8px" }}>Files to create</div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {list.map((f) => {
            const active = f.path === current?.path;
            return (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(f.path);
                    setEditing(false);
                  }}
                  aria-current={active ? "true" : undefined}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 7,
                    border: "none",
                    cursor: "pointer",
                    font: "inherit",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 12,
                    wordBreak: "break-all",
                    background: active ? "var(--bg-hover)" : "transparent",
                    color: active ? "var(--accent)" : "var(--text-primary, var(--text))",
                  }}
                >
                  <Icon.FileText size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{f.path}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {current && (
          <>
            <header
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12, flex: 1, wordBreak: "break-all" }}>
                {current.path}
              </span>
              {current.editable ? (
                <>
                  {dirty && <Badge color="var(--warn, var(--accent))">edited</Badge>}
                  {dirty && (
                    <Button
                      kind="ghost"
                      size="sm"
                      onClick={() => {
                        onReset(current.path);
                        setEditing(false);
                      }}
                    >
                      Reset
                    </Button>
                  )}
                  <Button kind="secondary" size="sm" icon="Edit" onClick={() => setEditing((v) => !v)}>
                    {editing ? "Done editing" : "Edit"}
                  </Button>
                </>
              ) : (
                <Badge color="var(--text-muted)">{isRunner ? "bundled · read-only" : "read-only"}</Badge>
              )}
            </header>
            {isRunner ? (
              <div style={{ padding: 16, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                Bundled <code>agent-runner</code> ({formatBytes(new TextEncoder().encode(current.contents).length)},
                minified). It runs <code>reviewer-core</code> with the grounding gate and is committed as-is — not shown
                here. Rebuild it with <code>pnpm build</code> in <code>agent-runner/</code>.
              </div>
            ) : editing && current.editable ? (
              <textarea
                aria-label={`Edit ${current.path}`}
                value={contents}
                spellCheck={false}
                onChange={(e) => onEdit(current.path, e.target.value)}
                style={{ ...codeBox, flex: 1, minHeight: 280, resize: "vertical", outline: "none" }}
              />
            ) : (
              <pre style={{ ...codeBox, flex: 1, maxHeight: 360 }}>{contents}</pre>
            )}
          </>
        )}
      </section>
    </div>
  );
}
