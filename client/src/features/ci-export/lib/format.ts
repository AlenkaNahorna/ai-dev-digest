/** Display helpers for the CI tab and CI Runs list. Pure, no React. */

/** `3m ago`, `2h ago`, `5d ago`, or the date for anything older. `null` → `—`. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const d = new Date(then);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type VerdictTone = "ok" | "warn" | "crit" | "muted";

/**
 * Map a CI outcome (`verdict` or legacy `status`) to a display label + tone.
 * Deterministic and purely presentational — the verdict itself is derived on the
 * server from grounded findings (AC-10), never here.
 */
export function verdictDisplay(verdict: string | null | undefined): { label: string; tone: VerdictTone } {
  switch (verdict) {
    case "approve":
    case "succeeded":
    case "no_findings":
      return { label: verdict === "no_findings" ? "No findings" : "Passed", tone: "ok" };
    case "comment":
      return { label: "Commented", tone: "warn" };
    case "request_changes":
    case "failed":
      return { label: verdict === "failed" ? "Failed" : "Changes requested", tone: "crit" };
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

/** Version of the exported workflow vs what this studio would generate today. */
export function workflowVersionState(
  installed: number | null | undefined,
  latest: number | null | undefined,
): { label: string; outdated: boolean } {
  if (installed == null) return { label: "version unknown", outdated: false };
  const outdated = latest != null && installed < latest;
  return { label: `workflow v${installed}`, outdated };
}

/** "Fail CI on" choices (values mirror the shared `CiFailOn`; labels for the CI tab). */
export const FAIL_ON_OPTIONS: { value: "never" | "critical" | "warning" | "any"; label: string }[] = [
  { value: "never", label: "Never block — comment only" },
  { value: "critical", label: "CRITICAL (recommended)" },
  { value: "warning", label: "WARNING or CRITICAL" },
  { value: "any", label: "Any finding" },
];

export const POST_AS_LABELS: Record<string, string> = {
  github_review: "GitHub review",
  pr_comment: "PR comment",
  none: "Exit code only",
};

/** `12.3 KB` for the bundled-runner row in the Preview step. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
