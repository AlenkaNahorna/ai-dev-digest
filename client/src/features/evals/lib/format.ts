/** Display helpers for eval metrics. Metrics are stored in [0,1]; the UI shows percentages. */

export function pct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)}%`;
}

export type DeltaTone = "up" | "down" | "flat" | "none";

/** Signed percentage points (`+4pt`) and the tone for colouring. `null` → no comparison. */
export function deltaPoints(v: number | null | undefined): { text: string; tone: DeltaTone } {
  if (v == null || !Number.isFinite(v)) return { text: "—", tone: "none" };
  const pts = Math.round(v * 100);
  if (pts === 0) return { text: "0pt", tone: "flat" };
  return { text: `${pts > 0 ? "+" : "−"}${Math.abs(pts)}pt`, tone: pts > 0 ? "up" : "down" };
}

/** `v7` for a known agent version, `—` otherwise. */
export function versionLabel(v: number | null | undefined): string {
  return v == null ? "—" : `v${v}`;
}

/** `2026-05-29 09:14` in local time. */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
