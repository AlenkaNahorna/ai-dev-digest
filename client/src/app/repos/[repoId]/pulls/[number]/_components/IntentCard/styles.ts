import type { CSSProperties } from "react";

/** Co-located styles for IntentCard. */
export const s = {
  wrap: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  summary: {
    fontSize: 15,
    lineHeight: 1.55,
    fontStyle: "italic",
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,
  cols: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 } satisfies CSSProperties,
  colTitle: (color: string): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color,
    marginBottom: 6,
  }),
  list: { margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-tertiary)" } satisfies CSSProperties,
  chips: { display: "flex", flexWrap: "wrap", gap: 6 } satisfies CSSProperties,
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-tertiary)", marginBottom: 6 } satisfies CSSProperties,
  missing: {
    border: "1px solid var(--warning, #d29922)",
    borderRadius: 8,
    padding: "10px 12px",
    background: "var(--bg-hover)",
  } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--danger, #f85149)" } satisfies CSSProperties,
} as const;
