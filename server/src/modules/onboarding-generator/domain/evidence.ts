import type { EvidenceReport } from '@devdigest/shared/contracts/onboarding-generator.js';
import { estimateTokens } from './documents.js';
import { EVIDENCE_LIMITS } from './limits.js';

/**
 * Evidence captured from ONE completed index revision. Everything here is data
 * for the prompt and for grounding model output; none of it is an instruction.
 */
export interface EvidenceDocument {
  /** Repo-relative path — also the "source id" setup steps must cite. */
  path: string;
  kind: 'readme' | 'contributing' | 'doc' | 'manifest' | 'config' | 'env_example';
  text: string;
  truncated: boolean;
}

export interface EvidenceExcerpt {
  path: string;
  text: string;
}

export interface EvidenceSymbol {
  file: string;
  name: string;
  kind: string;
  exported: boolean;
}

export interface CapturedEvidence {
  repoFullName: string;
  /** Full 40-char commit SHA all reads were pinned to. */
  sourceSha: string;
  indexedAt: Date;
  indexerVersion: number;
  indexStatus: 'full' | 'partial';
  documents: EvidenceDocument[];
  excerpts: EvidenceExcerpt[];
  rankedFiles: string[];
  /** Dependency chains from the highest-ranked files (also the supported diagram edges). */
  criticalChains: string[][];
  symbols: EvidenceSymbol[];
  repoMap: string | null;
  /** Readable file paths at the pinned commit; output paths must be members. */
  pathInventory: ReadonlySet<string>;
  report: EvidenceReport;
}

/** Edges the graph evidence supports: consecutive pairs of each critical chain. */
export function supportedEdges(evidence: Pick<CapturedEvidence, 'criticalChains'>): Set<string> {
  const edges = new Set<string>();
  for (const chain of evidence.criticalChains) {
    for (let i = 0; i + 1 < chain.length; i += 1) edges.add(edgeKey(chain[i]!, chain[i + 1]!));
  }
  return edges;
}

export function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/**
 * True when there is genuine, usable repository evidence (AC-3). A `partial`
 * status alone is NOT evidence: at least ranked files, a critical chain, symbols
 * or a readable document must exist.
 */
export function hasUsableEvidence(e: Pick<CapturedEvidence, 'rankedFiles' | 'criticalChains' | 'symbols' | 'documents'>): boolean {
  return (
    e.rankedFiles.length > 0 || e.criticalChains.length > 0 || e.symbols.length > 0 || e.documents.length > 0
  );
}

/** True when the graph can support a diagram at all. */
export function hasGraphEvidence(e: Pick<CapturedEvidence, 'criticalChains' | 'rankedFiles'>): boolean {
  return e.criticalChains.length > 0 || e.rankedFiles.length >= 2;
}

/** Serialized-size/token guard applied to the prompt's evidence block before it is sent. */
export function withinEvidenceBounds(serialized: string): boolean {
  return (
    Buffer.byteLength(serialized, 'utf8') <= EVIDENCE_LIMITS.serializedBytes &&
    estimateTokens(serialized) <= EVIDENCE_LIMITS.evidenceTokens
  );
}
