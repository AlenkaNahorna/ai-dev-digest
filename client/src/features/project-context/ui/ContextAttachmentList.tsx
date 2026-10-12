"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, ErrorState, IconBtn, Modal, Skeleton, TextInput } from "@devdigest/ui";
import type { ContextOwnerKind } from "@/shared/api/query-keys";
import { useContextAttachments, useProjectContext, useSaveContextAttachments } from "../api/hooks";
import {
  attachedTokens,
  buildRows,
  formatTokens,
  moveAttachment,
  overWarning,
  reorderAttachment,
  toggleAttachment,
  type AttachedItem,
} from "../model/attachments";
import { ContextDocPreview } from "./ContextDocPreview";

export interface ContextAttachmentListProps {
  /** Whose attachments are edited: an agent or a skill. */
  kind: ContextOwnerKind;
  ownerId: string;
  /** Active repository; attachments are stored per repo. `null` shows a "select a repo" note. */
  repoId: string | null;
}

/**
 * Shared Context tab body for agents and skills (same list and attach/detach
 * behavior): checkbox, path, type badge, Preview, "N of M attached", filter,
 * reorder (move up/down buttons for keyboard + drag), missing rows flagged and
 * removable, pending/error feedback and a token total with a warning above the
 * server-configured threshold. Only path + order are persisted.
 */
export function ContextAttachmentList({ kind, ownerId, repoId }: ContextAttachmentListProps) {
  const t = useTranslations("context");
  const list = useProjectContext(repoId);
  const attachments = useContextAttachments(kind, ownerId, repoId);
  const save = useSaveContextAttachments(kind, ownerId);
  const [filter, setFilter] = React.useState("");
  const [dragged, setDragged] = React.useState<string | null>(null);
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  if (!repoId) return <p style={{ color: "var(--text-secondary)" }}>{t("attach.noRepo")}</p>;

  if ((list.isError && !list.data) || (attachments.isError && !attachments.data)) {
    return (
      <ErrorState
        title={t("attach.loadError")}
        body={t("attach.loadErrorBody")}
        onRetry={() => {
          void list.refetch();
          void attachments.refetch();
        }}
      />
    );
  }
  if (!list.data || !attachments.data) {
    return (
      <div aria-busy="true" aria-label={t("attach.loading")} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton height={36} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  const files = list.data.files;
  // While a save is in flight show the set being saved, so the counter and the
  // token total react immediately; a failed save falls back to the stored set.
  const current: AttachedItem[] = save.isPending && save.variables ? save.variables.docs : attachments.data.docs;
  const rows = buildRows(files, current, filter);
  const discovered = new Set(files.map((f) => f.path));
  const attachedCount = current.filter((d) => discovered.has(d.path)).length;
  const total = attachedTokens(files, current);
  const warn = overWarning(total, list.data);
  const saving = save.isPending;

  const commit = (docs: { path: string; order: number }[]) => save.mutate({ repo_id: repoId, docs });
  const lastIndex = current.length - 1;

  return (
    <section aria-label={t("attach.heading")}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h2 style={{ flex: 1, fontSize: 16, fontWeight: 650 }}>
          {t("attach.heading")}{" "}
          <Badge color="var(--accent-text)" mono>
            {t("attach.counter", { attached: attachedCount, total: files.length })}
          </Badge>
        </h2>
        <span className="mono tnum" style={{ fontSize: 13, color: warn ? "var(--warn)" : "var(--text-secondary)" }}>
          {t(kind === "agent" ? "attach.total" : "attach.totalSkill", { count: formatTokens(total) })}
        </span>
        <TextInput value={filter} onChange={setFilter} placeholder={t("attach.filter")} aria-label={t("attach.filterLabel")} />
      </div>

      <p style={{ color: "var(--text-secondary)", margin: "12px 0 6px", fontSize: 13.5 }}>
        {t(kind === "agent" ? "attach.intro" : "attach.introSkill")}
      </p>

      {warn && (
        <p role="status" style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--warn)", fontSize: 13, margin: "6px 0" }}>
          {t("attach.warning", { limit: formatTokens(list.data.warn_tokens) })}
        </p>
      )}
      {saving && (
        <p role="status" style={{ color: "var(--text-muted)", fontSize: 12.5, margin: "6px 0" }}>
          {t("attach.saving")}
        </p>
      )}
      {save.isError && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: "6px 0" }}>
          {t("attach.saveError")}
        </p>
      )}
      {(list.isError || attachments.isError) && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 13, margin: "6px 0" }}>
          {t("attach.loadError")}{" "}
          <Button
            kind="ghost"
            size="sm"
            onClick={() => {
              void list.refetch();
              void attachments.refetch();
            }}
          >
            {t("retry")}
          </Button>
        </p>
      )}

      {files.length === 0 && current.length === 0 ? (
        <p style={{ color: "var(--text-secondary)", marginTop: 16 }}>{t("attach.emptyList", { roots: list.data.roots.join(", ") })}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--text-secondary)", marginTop: 16 }}>{t("attach.noMatches", { q: filter.trim() })}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((row) => (
            <li
              key={row.path}
              draggable={row.attached && !saving}
              onDragStart={() => setDragged(row.path)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragged && dragged !== row.path && row.attached) commit(reorderAttachment(current, dragged, row.path));
                setDragged(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                marginTop: 8,
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: row.attached ? "var(--bg-elevated)" : "transparent",
              }}
            >
              <span
                title={row.attached ? t("attach.dragHandle") : undefined}
                aria-hidden="true"
                style={{ color: "var(--text-muted)", cursor: row.attached ? "grab" : "default", fontSize: 18, width: 14 }}
              >
                {row.attached ? "⠿" : ""}
              </span>
              <Checkbox
                ariaLabel={t("attach.attachLabel", { path: row.path })}
                checked={row.attached}
                disabled={saving}
                onChange={() => commit(toggleAttachment(current, row.path))}
              />
              <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 13, wordBreak: "break-all" }}>
                {row.path}
              </span>
              {row.missing && (
                <span title={t("attach.missingHelp")}>
                  <Badge color="var(--warn)" icon="AlertTriangle">
                    {t("attach.missing")}
                  </Badge>
                </span>
              )}
              {row.type && <Badge mono>{row.type}</Badge>}
              <span className="mono tnum" style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 80, textAlign: "right" }}>
                {row.tokens != null ? t("list.tokens", { count: formatTokens(row.tokens) }) : ""}
              </span>
              {row.attached && row.position != null && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                  <span style={{ color: "var(--text-muted)", fontSize: 12, marginRight: 4 }}>{t("attach.order", { n: row.position + 1 })}</span>
                  {row.position > 0 && !saving && (
                    <IconBtn icon="ArrowUp" size={26} label={t("attach.moveUp", { path: row.path })} onClick={() => commit(moveAttachment(current, row.path, -1))} />
                  )}
                  {row.position < lastIndex && !saving && (
                    <IconBtn icon="ArrowDown" size={26} label={t("attach.moveDown", { path: row.path })} onClick={() => commit(moveAttachment(current, row.path, 1))} />
                  )}
                </span>
              )}
              {row.missing ? (
                <Button kind="secondary" size="sm" icon="Trash" disabled={saving} aria-label={t("attach.removeLabel", { path: row.path })} onClick={() => commit(toggleAttachment(current, row.path))}>
                  {t("attach.remove")}
                </Button>
              ) : (
                <Button kind="secondary" size="sm" icon="Eye" aria-label={t("attach.previewLabel", { path: row.path })} onClick={() => setPreviewPath(row.path)}>
                  {t("attach.preview")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {previewPath && (
        <Modal width={860} title={previewPath} subtitle={t("preview.title")} onClose={() => setPreviewPath(null)}>
          <ContextDocPreview repoId={repoId} path={previewPath} />
        </Modal>
      )}

      {kind === "skill" && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>{t("attach.serializesAs")}</div>
          <pre className="mono" aria-label={t("attach.serializesAs")} style={{ margin: 0, padding: 14, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-surface)", fontSize: 12.5, whiteSpace: "pre-wrap" }}>
            {t("attach.serializesHeading")}
            {"\n"}
            {current.length === 0 ? t("attach.serializesNone") : [...current].sort((a, b) => a.order - b.order).map((d) => `- ${d.path}`).join("\n")}
          </pre>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{t("attach.serializesNote")}</p>
        </div>
      )}
    </section>
  );
}
