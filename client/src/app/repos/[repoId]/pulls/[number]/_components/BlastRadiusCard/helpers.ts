import type { BlastDegradedReason, BlastRadius, ChangedSymbol, DownstreamImpact } from "@devdigest/shared";

export interface BlastCounts {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/** Aggregate numbers, computed from the same rows the card renders (never parsed from `summary`). */
export function blastCounts(data: BlastRadius): BlastCounts {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const d of data.downstream) {
    callers += d.callers.length;
    for (const e of d.endpoints_affected) endpoints.add(e);
    for (const c of d.crons_affected) crons.add(c);
  }
  return { symbols: data.changed_symbols.length, callers, endpoints: endpoints.size, crons: crons.size };
}

export function callersForSymbol(data: BlastRadius, name: string): DownstreamImpact | undefined {
  return data.downstream.find((d) => d.symbol === name);
}

const DEGRADED_KEYS = {
  flag_off: "degraded.flag_off",
  index_failed: "degraded.index_failed",
  index_partial: "degraded.index_partial",
  repo_too_large: "degraded.repo_too_large",
  no_data: "degraded.no_data",
} as const satisfies Record<BlastDegradedReason, string>;

/** Typed reason -> message key; a degraded result without a reason gets the generic copy. */
export function degradedMessageKey(reason: BlastDegradedReason | undefined): (typeof DEGRADED_KEYS)[BlastDegradedReason] | "degraded.generic" {
  return reason ? DEGRADED_KEYS[reason] : "degraded.generic";
}

export type RepoIndexStatus = "full" | "partial" | "degraded" | "failed";

/** True when the blast data or the repo index tells the reader that callers may be missing. */
export function isIndexIncomplete(data: BlastRadius, indexStatus: RepoIndexStatus | undefined): boolean {
  return data.degraded === true || (indexStatus !== undefined && indexStatus !== "full");
}

/**
 * Message key for the "index incomplete" mark. The blast response's own reason wins; otherwise the
 * repo index status explains it (a partial index is NOT reported as degraded by the facade).
 */
export function incompleteMessageKey(
  data: BlastRadius,
  indexStatus: RepoIndexStatus | undefined,
  indexReason: string | undefined,
): (typeof DEGRADED_KEYS)[BlastDegradedReason] | "degraded.generic" {
  if (data.degraded) return degradedMessageKey(data.degraded_reason);
  if (indexStatus === "partial") return DEGRADED_KEYS.index_partial;
  if (indexStatus === "failed") return DEGRADED_KEYS.index_failed;
  const known = (Object.keys(DEGRADED_KEYS) as BlastDegradedReason[]).find((k) => k === indexReason);
  return degradedMessageKey(known);
}

/** Repo index info shown as the "index incomplete" mark, with the resync action. */
export interface BlastIndexInfo {
  /** Anything but "full" shows the mark. */
  status?: RepoIndexStatus | undefined;
  /** Reason reported by the index state (used when the status is "degraded"). */
  reason?: string | undefined;
  /** Starts the resync; the button is hidden when omitted. */
  onResync?: (() => void) | undefined;
  resyncing?: boolean | undefined;
  resyncError?: boolean | undefined;
  /** The resync did not finish in time. */
  timedOut?: boolean | undefined;
}

export interface SymbolEntry {
  symbol: ChangedSymbol;
  /** How many more files declare a symbol with the same name (merged into this entry). */
  extraFiles: number;
}

/**
 * One entry per symbol NAME. The contract groups callers by name only, so same-named symbols
 * from different files share one downstream group; listing them separately would repeat the
 * same callers and clash on keys.
 */
export function symbolEntries(data: BlastRadius): SymbolEntry[] {
  const byName = new Map<string, SymbolEntry>();
  for (const symbol of data.changed_symbols) {
    const entry = byName.get(symbol.name);
    if (entry) entry.extraFiles += 1;
    else byName.set(symbol.name, { symbol, extraFiles: 0 });
  }
  return [...byName.values()];
}
