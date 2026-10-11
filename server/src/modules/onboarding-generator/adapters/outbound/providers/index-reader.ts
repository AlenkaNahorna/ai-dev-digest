import type { CurrentIndex, IndexReader } from '../../../application/ports/onboarding-ports.js';

/** The slice of the repo-intel facade this module needs (structural — no module-to-module import). */
export interface RepoIntelReads {
  getIndexState(repoId: string): Promise<{
    status: string;
    lastIndexedSha: string;
    indexerVersion: number;
    updatedAt: Date;
    degraded?: boolean;
  }>;
  getTopFilesByRank(repoId: string, n: number): Promise<string[]>;
  getCriticalPaths(repoId: string): Promise<string[][]>;
  getSymbolsInFiles(
    repoId: string,
    paths: string[],
  ): Promise<Array<{ file: string; name: string; kind: string; exported: boolean }>>;
  getRepoMap(repoId: string, tokenBudget?: number): Promise<{ text: string; degraded?: boolean }>;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * "Usable index" (AC-3): completed full/partial status, a full commit SHA, not a
 * synthesized degraded row, AND real ranked evidence (a `partial` flag alone is
 * not evidence). Cheap: one state row + a LIMIT-1-ish ranked probe; no LLM.
 */
export class RepoIntelIndexReader implements IndexReader {
  constructor(private readonly intel: RepoIntelReads) {}

  async currentUsableIndex(repoId: string): Promise<CurrentIndex | null> {
    const state = await this.intel.getIndexState(repoId);
    if (state.degraded) return null;
    if (state.status !== 'full' && state.status !== 'partial') return null;
    if (!FULL_SHA.test(state.lastIndexedSha)) return null;
    const top = await this.intel.getTopFilesByRank(repoId, 1);
    if (top.length === 0) return null;
    return {
      sourceSha: state.lastIndexedSha,
      indexedAt: state.updatedAt,
      indexerVersion: state.indexerVersion,
      indexStatus: state.status,
    };
  }
}
