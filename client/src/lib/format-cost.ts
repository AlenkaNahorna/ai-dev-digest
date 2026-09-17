/**
 * Shared USD cost formatter for agent-run cost — used by the PR list COST
 * column, the run timeline, and the trace drawer's Stats grid, so all three
 * render identically. Adaptive precision: 2 significant figures below $1
 * (e.g. "$0.0013", "$0.014"), standard 2-decimal currency at/above $1
 * ("$1.20"). `null`/`undefined` (no cost data, e.g. pre-existing runs from
 * before this field existed) renders "—", never a misleading "$0.00".
 */
export function formatCost(costUsd: number | null | undefined): string {
  if (costUsd == null || !Number.isFinite(costUsd)) return "—";
  if (costUsd === 0) return "$0.00";
  const sign = costUsd < 0 ? "-" : "";
  const abs = Math.abs(costUsd);
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;

  const decimals = Math.max(2, 1 - Math.floor(Math.log10(abs)));
  const minLength = abs.toFixed(2).length;
  let s = abs.toFixed(decimals);
  while (s.length > minLength && s.endsWith("0")) s = s.slice(0, -1);
  return `${sign}$${s}`;
}
