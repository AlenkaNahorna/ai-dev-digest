/** Display helpers for the CI Runs list. Pure, no React. */

export type VerdictTone = "ok" | "warn" | "crit" | "muted";

/**
 * Map a CI outcome (`verdict` or legacy `status`) to a display label + tone.
 * Purely presentational — the verdict is derived on the server from grounded
 * findings (AC-10), never here.
 */
export function verdictDisplay(verdict: string | null | undefined): { label: string; tone: VerdictTone } {
  switch (verdict) {
    case "approve":
    case "succeeded":
      return { label: "Passed", tone: "ok" };
    case "no_findings":
      return { label: "No findings", tone: "ok" };
    case "comment":
      return { label: "Commented", tone: "warn" };
    case "request_changes":
      return { label: "Changes requested", tone: "crit" };
    case "failed":
      return { label: "Failed", tone: "crit" };
    case "running":
      return { label: "Running", tone: "muted" };
    default:
      return { label: verdict ? verdict : "—", tone: "muted" };
  }
}

const TONE_COLORS: Record<VerdictTone, { color: string; bg: string }> = {
  ok: { color: "var(--ok)", bg: "var(--ok-bg, var(--bg-hover))" },
  warn: { color: "var(--warn, var(--accent))", bg: "var(--bg-hover)" },
  crit: { color: "var(--crit)", bg: "var(--crit-bg, var(--bg-hover))" },
  muted: { color: "var(--text-muted)", bg: "var(--bg-hover)" },
};

export function toneColors(tone: VerdictTone): { color: string; bg: string } {
  return TONE_COLORS[tone];
}

/** `12.3s` from ms (preferred) or seconds; `null` → `—`. */
export function formatDuration(ms: number | null | undefined, seconds?: number | null): string {
  const totalMs = ms != null ? ms : seconds != null ? seconds * 1000 : null;
  if (totalMs == null || !Number.isFinite(totalMs)) return "—";
  if (totalMs < 1000) return `${Math.round(totalMs)}ms`;
  return `${(totalMs / 1000).toFixed(1)}s`;
}

/** `#123` or `—` when no PR number is known. */
export function prLabel(prNumber: number | null | undefined): string {
  return prNumber == null ? "—" : `#${prNumber}`;
}

/** `2026-05-29 09:14` in local time; `null`/invalid → `—`. */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
