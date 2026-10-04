import { clipText } from './text.js';

/** Bounds for `get_blast_radius` (symbol, file and endpoint names come from an index of untrusted code). */
export const BLAST_SYMBOLS_MAX = 30;
export const BLAST_GROUPS_MAX = 20;
export const BLAST_CALLERS_MAX = 10;
export const BLAST_FACTS_MAX = 10;
export const NAME_MAX = 100;
export const FILE_MAX = 200;
export const FACT_MAX = 100;
export const SUMMARY_MAX = 200;

export interface BlastInput {
  readonly changed_symbols: readonly { readonly name: string; readonly file: string; readonly kind: string }[];
  readonly downstream: readonly {
    readonly symbol: string;
    readonly callers: readonly { readonly name: string; readonly file: string; readonly line: number }[];
    readonly endpoints_affected: readonly string[];
    readonly crons_affected: readonly string[];
  }[];
  readonly summary: string;
  readonly degraded?: boolean | undefined;
  readonly degraded_reason?: string | undefined;
}

export interface BlastView {
  summary: string;
  changed_symbols: { name: string; file: string; kind: string }[];
  downstream: {
    symbol: string;
    callers: { name: string; file: string; line: number }[];
    /** Callers cut by the per-group cap; omitted when nothing was cut. */
    more_callers?: number;
    endpoints: string[];
    crons: string[];
  }[];
  /** Changed symbols plus downstream groups cut by the caps; omitted when nothing was cut. */
  more?: number;
  degraded?: true;
  degraded_reason?: string;
  /** Fixed text chosen from the reason; never API text. */
  hint?: string;
}

const HINTS: Readonly<Record<string, string>> = {
  flag_off: 'Repository indexing is off, so this result is partial. Ask the user to enable it in DevDigest and resync the repo.',
  index_failed: 'Indexing this repository failed, so this result is partial. Ask the user to resync the repo in DevDigest.',
  index_partial: 'The repository index is incomplete, so callers may be missing. Ask the user to resync the repo in DevDigest.',
  repo_too_large: 'The repository is too large to index fully, so callers may be missing.',
  no_data:
    'Index data is missing or partial for this PR. Open the PR in DevDigest once, or ask the user to resync the repo.',
};
const GENERIC_HINT = 'This result is partial. Ask the user to resync the repo in DevDigest.';

/** Caps and trims only; every number comes from the API (no recalculation). */
export function shapeBlast(input: BlastInput): BlastView {
  const changed_symbols = input.changed_symbols.slice(0, BLAST_SYMBOLS_MAX).map((s) => ({
    name: clipText(s.name, NAME_MAX),
    file: clipText(s.file, FILE_MAX),
    kind: clipText(s.kind, 30),
  }));
  const groups = input.downstream.slice(0, BLAST_GROUPS_MAX);
  const downstream = groups.map((g) => {
    const callers = g.callers.slice(0, BLAST_CALLERS_MAX).map((c) => ({
      name: clipText(c.name, NAME_MAX),
      file: clipText(c.file, FILE_MAX),
      line: c.line,
    }));
    const cut = g.callers.length - callers.length;
    return {
      symbol: clipText(g.symbol, NAME_MAX),
      callers,
      ...(cut > 0 ? { more_callers: cut } : {}),
      endpoints: g.endpoints_affected.slice(0, BLAST_FACTS_MAX).map((e) => clipText(e, FACT_MAX)),
      crons: g.crons_affected.slice(0, BLAST_FACTS_MAX).map((c) => clipText(c, FACT_MAX)),
    };
  });
  const more =
    input.changed_symbols.length - changed_symbols.length + (input.downstream.length - downstream.length);

  const view: BlastView = { summary: clipText(input.summary, SUMMARY_MAX), changed_symbols, downstream };
  if (more > 0) view.more = more;
  if (input.degraded === true) {
    view.degraded = true;
    if (input.degraded_reason !== undefined) view.degraded_reason = clipText(input.degraded_reason, 30);
    view.hint = (input.degraded_reason !== undefined ? HINTS[input.degraded_reason] : undefined) ?? GENERIC_HINT;
  }
  return view;
}
