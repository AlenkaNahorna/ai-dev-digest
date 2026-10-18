/* Multi-agent picker (AC-1..6). Lists every workspace agent with a checkbox;
   enabled agents are preselected, disabled agents are listed but not selectable.
   Clear resets to nothing, the primary button shows the selected count and is
   disabled at zero, and starting posts the selected ids and navigates to the
   results page. Does NOT replace the single-agent / "Run all" RunReviewDropdown. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { ApiError } from "@/lib/api";
import { useMultiAgentEstimate, useStartMultiAgentRun } from "../api/hooks";
import { summarizeEstimates } from "../model/estimate";
import { EstimateFooter } from "./EstimateFooter";

export function AgentPicker({ prId }: { prId: string }) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const { data: agents } = useAgents();
  const start = useStartMultiAgentRun(prId);

  const all = React.useMemo(() => agents ?? [], [agents]);
  const [open, setOpen] = React.useState(false);
  // Selection is the single source of truth; `null` means "not yet initialised".
  const [selected, setSelected] = React.useState<Set<string> | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Preselect enabled agents once the list arrives (derive default, then owned by user).
  React.useEffect(() => {
    if (selected == null && all.length) {
      setSelected(new Set(all.filter((a) => a.enabled).map((a) => a.id)));
    }
  }, [all, selected]);

  // Close on outside click / Escape (keyboard-operable).
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedIds = React.useMemo(() => [...(selected ?? [])], [selected]);
  const estimateQuery = useMultiAgentEstimate(open ? prId : null, selectedIds);
  const estimate = React.useMemo(
    () => summarizeEstimates(estimateQuery.data?.estimates ?? []),
    [estimateQuery.data],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clear = () => setSelected(new Set());

  const runLabel =
    selectedIds.length === 0
      ? t("picker.runButtonZero")
      : selectedIds.length === 1
        ? t("picker.runButtonOne")
        : t("picker.runButton", { count: selectedIds.length });

  const onStart = async () => {
    if (!selectedIds.length) return;
    try {
      const res = await start.mutateAsync(selectedIds);
      setOpen(false);
      router.push(`/multi-agent?pr=${encodeURIComponent(prId)}&run=${encodeURIComponent(res.parent_id)}`);
    } catch {
      /* error surfaced below via start.error */
    }
  };

  const startError =
    start.error instanceof ApiError && start.error.code === "multi_agent_run_active"
      ? t("picker.activeError")
      : start.isError
        ? t("picker.startError")
        : null;

  return (
    <div ref={panelRef} style={{ position: "relative", display: "inline-block" }}>
      <Button kind="secondary" size="sm" icon="Users" iconRight="ChevronDown" onClick={() => setOpen((o) => !o)}>
        {t("picker.trigger")}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={t("picker.heading")}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 320,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 9,
            boxShadow: "var(--shadow-modal)",
            padding: 14,
            zIndex: 40,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong style={{ fontSize: 13 }}>{t("picker.heading")}</strong>
            <button
              type="button"
              onClick={clear}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12 }}
            >
              {t("picker.clear")}
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("picker.subheading")}</p>

          {all.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("picker.noAgents")}</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto" }}>
              {all.map((a) => {
                const isSelected = selected?.has(a.id) ?? false;
                return (
                  <li
                    key={a.id}
                    title={a.enabled ? undefined : t("picker.notSelectable")}
                    style={{ display: "flex", alignItems: "center", gap: 8, opacity: a.enabled ? 1 : 0.55 }}
                  >
                    <Checkbox
                      checked={isSelected}
                      disabled={!a.enabled}
                      ariaLabel={a.name}
                      onChange={() => a.enabled && toggle(a.id)}
                      label={
                        <span style={{ fontSize: 13 }}>
                          {a.name}{" "}
                          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                            {a.model}
                            {a.enabled ? "" : ` · ${t("picker.disabledSuffix")}`}
                          </span>
                        </span>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}

          <EstimateFooter
            summary={estimate}
            loading={estimateQuery.isFetching && selectedIds.length > 0}
          />

          {startError && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--danger, #e5484d)" }}>
              {startError}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <a href="/agents" style={{ fontSize: 12, color: "var(--accent)" }}>
              {t("picker.configureAgents")}
            </a>
            <Button
              kind="primary"
              size="sm"
              icon="Play"
              disabled={selectedIds.length === 0 || start.isPending}
              loading={start.isPending}
              onClick={onStart}
            >
              {runLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
