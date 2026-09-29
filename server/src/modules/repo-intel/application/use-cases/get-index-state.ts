import type { IndexState } from '../../types.js';
import { INDEXER_VERSION } from '../../constants.js';

export interface IndexStateReader {
  tryGetIndexState(repoId: string): Promise<IndexState | null | undefined>;
}

/** Application use-case for the degraded-safe index state read. */
export class GetIndexState {
  constructor(private readonly reader: IndexStateReader) {}

  async execute(repoId: string): Promise<IndexState> {
    const persisted = await this.reader.tryGetIndexState(repoId);
    if (persisted) return persisted;
    return {
      repoId, status: 'degraded', filesIndexed: 0, filesSkipped: 0, durationMs: 0,
      reason: 'no_data', lastIndexedSha: '', indexerVersion: INDEXER_VERSION,
      updatedAt: new Date(0), degraded: true, degradedReason: 'no_data',
    };
  }
}
