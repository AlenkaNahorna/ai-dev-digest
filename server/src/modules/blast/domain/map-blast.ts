import type { BlastRadius } from '@devdigest/shared';
import type { BlastResult } from '../../repo-intel/types.js';

type Group = {
  symbol: string;
  callers: { name: string; file: string; line: number; rank: number }[];
};

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pure mapping of the repo-intel blast result onto the `BlastRadius` contract.
 * All numbers (summary included) are computed from the mapped `downstream`,
 * never from `impactedEndpoints`, so server, UI and MCP always agree.
 */
export function mapBlast(result: BlastResult): BlastRadius {
  const seenSymbols = new Set<string>();
  const changed_symbols: BlastRadius['changed_symbols'] = [];
  for (const s of result.changedSymbols) {
    const key = `${s.name}:${s.file}`;
    if (seenSymbols.has(key)) continue;
    seenSymbols.add(key);
    changed_symbols.push({ name: s.name, file: s.file, kind: s.kind });
  }

  const groups = new Map<string, Group>();
  const seenCallers = new Set<string>();
  for (const c of result.callers) {
    const key = `${c.viaSymbol}|${c.file}|${c.symbol}|${c.line}`;
    if (seenCallers.has(key)) continue;
    seenCallers.add(key);
    let g = groups.get(c.viaSymbol);
    if (!g) {
      g = { symbol: c.viaSymbol, callers: [] };
      groups.set(c.viaSymbol, g);
    }
    g.callers.push({ name: c.symbol, file: c.file, line: c.line, rank: c.rank });
  }

  const order = new Map<string, number>();
  changed_symbols.forEach((s, i) => {
    if (!order.has(s.name)) order.set(s.name, i);
  });
  const orderOf = (name: string): number => order.get(name) ?? Number.MAX_SAFE_INTEGER;

  const facts = result.factsByFile;
  const union = (files: string[], pick: 'endpoints' | 'crons'): string[] => {
    if (!facts) return [];
    const out = new Set<string>();
    for (const f of files) for (const v of facts[f]?.[pick] ?? []) out.add(v);
    return [...out].sort(byText);
  };

  const downstream: BlastRadius['downstream'] = [...groups.values()]
    .sort((a, b) => orderOf(a.symbol) - orderOf(b.symbol) || byText(a.symbol, b.symbol))
    .map((g) => {
      const callers = [...g.callers].sort((a, b) => b.rank - a.rank || byText(a.file, b.file) || a.line - b.line);
      const files = [...new Set(callers.map((c) => c.file))];
      return {
        symbol: g.symbol,
        callers: callers.map(({ name, file, line }) => ({ name, file, line })),
        endpoints_affected: union(files, 'endpoints'),
        crons_affected: union(files, 'crons'),
      };
    });

  const callerCount = downstream.reduce((n, d) => n + d.callers.length, 0);
  const endpoints = new Set(downstream.flatMap((d) => d.endpoints_affected));
  const crons = new Set(downstream.flatMap((d) => d.crons_affected));

  const degraded = result.degraded === true;
  return {
    changed_symbols,
    downstream,
    summary: formatBlastSummary(changed_symbols.length, callerCount, endpoints.size, crons.size),
    degraded,
    ...(degraded && result.reason ? { degraded_reason: result.reason } : {}),
  };
}

export function formatBlastSummary(symbols: number, callers: number, endpoints: number, crons: number): string {
  return `${symbols} symbols · ${callers} callers · ${endpoints} endpoints · ${crons} crons`;
}
