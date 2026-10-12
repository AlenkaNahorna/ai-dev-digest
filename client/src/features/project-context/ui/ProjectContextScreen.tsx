"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { useProjectContext, useRefreshProjectContext } from "../api/hooks";
import { formatTokens } from "../model/attachments";
import { ContextDocPreview } from "./ContextDocPreview";

/**
 * Project Context page: the repository's discovered Markdown documents, with a
 * read-only safe Markdown preview. Documents are view-only — the server clone
 * is a refreshed mirror, so there is deliberately no edit/new/upload control.
 */
export function ProjectContextScreen() {
  const t = useTranslations("context");
  const { activeRepo, reposLoaded } = useActiveRepo();
  const repoId = activeRepo?.id ?? null;
  const list = useProjectContext(repoId);
  const refresh = useRefreshProjectContext();
  const [selected, setSelected] = React.useState<string | null>(null);
  const crumb = [{ label: t("crumb") }];

  // A different repo has a different document set: drop the previous selection.
  React.useEffect(() => setSelected(null), [repoId]);

  if (reposLoaded && !activeRepo) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: 28 }}>
          <EmptyState icon="Boxes" title={t("noRepo.title")} body={t("noRepo.body")} />
        </div>
      </AppShell>
    );
  }

  const data = list.data;
  const files = data?.files ?? [];

  return (
    <AppShell crumb={crumb}>
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 52px)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "20px 28px 14px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t("title")}</h1>
            <p style={{ color: "var(--text-secondary)", marginTop: 4, fontSize: 13.5, maxWidth: 760 }}>
              {t("subtitle", { repo: activeRepo?.full_name ?? "" })}
            </p>
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={refresh.isPending || list.isFetching}
            disabled={!repoId || refresh.isPending}
            onClick={() => repoId && refresh.mutate(repoId)}
          >
            {refresh.isPending ? t("refreshing") : t("refresh")}
          </Button>
        </div>

        {refresh.isError && (
          <p role="alert" style={{ color: "var(--warn)", padding: "0 28px 8px", fontSize: 13 }}>
            {t("refreshFailed")}
          </p>
        )}

        {list.isError && !data ? (
          <ErrorState title={t("loadError")} body={t("loadErrorBody")} onRetry={() => void list.refetch()} />
        ) : !data ? (
          <div aria-busy="true" style={{ padding: "0 28px", display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={40} />
            <Skeleton height={40} />
            <Skeleton height={40} />
          </div>
        ) : (
          <>
            {list.isError && (
              <p role="alert" style={{ color: "var(--danger)", padding: "0 28px 8px", fontSize: 13 }}>
                {t("loadError")}{" "}
                <Button kind="ghost" size="sm" onClick={() => void list.refetch()}>
                  {t("retry")}
                </Button>
              </p>
            )}
            {files.length === 0 ? (
              <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body", { roots: data.roots.join(", ") })} />
            ) : (
              <div style={{ flex: 1, minHeight: 0, display: "flex", borderTop: "1px solid var(--border)" }}>
                <nav aria-label={t("list.heading")} style={{ width: 420, flexShrink: 0, overflow: "auto", borderRight: "1px solid var(--border)", padding: 12 }}>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {files.map((f) => (
                      <li key={f.path}>
                        <button
                          type="button"
                          aria-pressed={selected === f.path}
                          onClick={() => setSelected(f.path)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            width: "100%",
                            textAlign: "left",
                            padding: "9px 10px",
                            marginBottom: 4,
                            borderRadius: 7,
                            border: `1px solid ${selected === f.path ? "var(--accent)" : "transparent"}`,
                            background: selected === f.path ? "var(--bg-elevated)" : "transparent",
                            color: "var(--text-primary)",
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                            <span className="mono" style={{ fontSize: 12.5, wordBreak: "break-all" }}>
                              {f.path.slice(f.path.lastIndexOf("/") + 1)}
                            </span>
                            {f.path.includes("/") && (
                              <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)", wordBreak: "break-all" }}>
                                {f.path.slice(0, f.path.lastIndexOf("/") + 1)}
                              </span>
                            )}
                          </span>
                          {f.type && <Badge mono>{f.type}</Badge>}
                          <span className="mono tnum" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                            {f.tokens != null ? t("list.tokens", { count: formatTokens(f.tokens) }) : t("list.noTokens")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
                <main style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
                  {selected && repoId ? (
                    <ContextDocPreview repoId={repoId} path={selected} showUsage />
                  ) : (
                    <p style={{ padding: 28, color: "var(--text-secondary)" }}>{t("list.select")}</p>
                  )}
                </main>
              </div>
            )}
            <footer
              style={{ display: "flex", gap: 20, padding: "10px 28px", borderTop: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-secondary)" }}
            >
              <span>{t("footer.files", { count: data.index.files })}</span>
              <span className="mono tnum">{t("footer.tokensTotal", { count: formatTokens(data.tokens_total ?? 0) })}</span>
              <span>{t("footer.lastIndex", { time: new Date(data.index.indexed_at).toLocaleTimeString() })}</span>
            </footer>
          </>
        )}
      </div>
    </AppShell>
  );
}
