import type React from "react";

export const codeBox: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 12,
  lineHeight: 1.5,
  padding: 12,
  margin: 0,
  overflow: "auto",
  whiteSpace: "pre",
  background: "var(--bg-sunken, var(--bg-elevated))",
  color: "var(--text-primary, var(--text))",
  border: "none",
  borderRadius: 0,
};

export const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  color: "var(--text-muted)",
  textTransform: "uppercase",
};

export function optionCard(selected: boolean, disabled = false): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    textAlign: "left",
    padding: "14px 16px",
    borderRadius: 10,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    border: `1px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
    background: selected ? "var(--accent-bg, var(--bg-hover))" : "var(--bg-surface, var(--bg-elevated))",
    color: "var(--text-primary, var(--text))",
    font: "inherit",
  };
}
