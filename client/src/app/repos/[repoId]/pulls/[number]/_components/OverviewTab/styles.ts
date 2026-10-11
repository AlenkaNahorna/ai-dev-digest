import type { CSSProperties } from "react";

export const s = {
  /** Intent | Blast radius side by side; collapses to one column on narrow screens. */
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
    gap: 16,
    alignItems: "start",
  } satisfies CSSProperties,
  /** Left column: the Intent block with the Risk areas under it. */
  column: { display: "flex", flexDirection: "column", gap: 16, minWidth: 0 } satisfies CSSProperties,
  /** Keeps the description readable now that the Overview tab uses the full width. */
  descriptionSection: { maxWidth: 1080 } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
