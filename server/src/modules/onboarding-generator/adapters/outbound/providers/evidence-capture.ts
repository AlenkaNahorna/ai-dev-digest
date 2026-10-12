import type { EvidenceReport } from '@devdigest/shared/contracts/onboarding-generator.js';
import type { CaptureOutcome, EvidenceCapture, IndexReader, RepoRecord } from '../../../application/ports/onboarding-ports.js';
import type { RepoIndexLock } from '../../../../../platform/repo-index-lock.js';
import {
  classifyDocPath,
  docPriority,
  isCredentialPath,
  isExcludedPath,
  isReadableText,
  truncateUtf8,
  type DocKind,
} from '../../../domain/documents.js';
import {
  hasUsableEvidence,
  type CapturedEvidence,
  type EvidenceDocument,
  type EvidenceExcerpt,
  type EvidenceSymbol,
} from '../../../domain/evidence.js';
import { EVIDENCE_LIMITS, GENERATION_TIMING } from '../../../domain/limits.js';
import { reduceEnvExample, screenDocument } from '../../../domain/secret-screen.js';
import { GitRevisionError, GitRevisionReader, type TreeEntry } from './git-revision-reader.js';
import type { RepoIntelReads } from './index-reader.js';

const FULL_SHA = /^[0-9a-f]{40}$/;
const EXCERPT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|scala)$/i;

interface Deps {
  intel: RepoIntelReads;
  index: IndexReader;
  lock: RepoIndexLock;
  git: GitRevisionReader;
}

/**
 * Captures bounded, revision-consistent evidence (Step 2).
 *
 * Consistency: index facts (state, ranks, chains, symbols, repo map) are read
 * while holding the per-repo index lock, so a concurrent re-index cannot
 * interleave; the SHA read there pins every subsequent Git read, so the document
 * text always belongs to the same commit as the facts.
 */
export class IndexedEvidenceCapture implements EvidenceCapture {
  constructor(private readonly deps: Deps) {}

  async capture(repo: RepoRecord): Promise<CaptureOutcome> {
    if (!repo.clonePath) return { kind: 'unavailable', reason: 'repository has no local clone' };

    const facts = await this.deps.lock.withLock(
      repo.id,
      async () => {
        const idx = await this.deps.index.currentUsableIndex(repo.id);
        if (!idx) return null;
        const rankedFiles = await this.deps.intel.getTopFilesByRank(repo.id, EVIDENCE_LIMITS.rankedFiles);
        const chains = (await this.deps.intel.getCriticalPaths(repo.id))
          .slice(0, EVIDENCE_LIMITS.criticalChains)
          .map((c) => c.slice(0, EVIDENCE_LIMITS.chainLength))
          .filter((c) => c.length >= 2);
        const symbolFiles = [...new Set([...rankedFiles, ...chains.flat()])].slice(0, 60);
        const symbolRows = await this.deps.intel.getSymbolsInFiles(repo.id, symbolFiles);
        const map = await this.deps.intel.getRepoMap(repo.id);
        return { idx, rankedFiles, chains, symbolRows, map };
      },
      { timeoutMs: GENERATION_TIMING.captureLockTimeoutMs },
    );
    if (!facts) return { kind: 'unavailable', reason: 'no usable index' };
    const { idx } = facts;
    if (!FULL_SHA.test(idx.sourceSha)) return { kind: 'unavailable', reason: 'index has no full commit hash' };

    const git = this.deps.git;
    try {
      if (!(await git.commitExists(repo.clonePath, idx.sourceSha))) {
        return { kind: 'unavailable', reason: 'indexed commit is not present in the local clone' };
      }

      const notes: string[] = [];
      let truncated = false;

      // ---- path inventory (membership check for model-cited paths)
      let entries: TreeEntry[];
      const tree = await git.listTree(repo.clonePath, idx.sourceSha, EVIDENCE_LIMITS.inventoryPaths);
      if (tree.overflow) {
        truncated = true;
        notes.push(`inventory capped at ${EVIDENCE_LIMITS.inventoryPaths} paths`);
        const evidencePaths = [...facts.rankedFiles, ...facts.chains.flat()];
        entries = (await git.listPaths(repo.clonePath, idx.sourceSha, evidencePaths, 500)).entries;
        // Keep the bounded prefix too so well-known docs can still be found.
        entries = [...tree.entries, ...entries];
      } else {
        entries = tree.entries;
      }
      // Membership set for grounding: credential files are never citable, but ordinary
      // source under dirs such as `build/` or `vendor/` stays valid. Documents (below)
      // additionally skip dependency/build output and lockfiles.
      const safeEntries = entries.filter((e) => !isCredentialPath(e.path));
      const inventory = new Set(safeEntries.map((e) => e.path));

      // ---- documents
      const candidates = safeEntries
        .filter((e) => !isExcludedPath(e.path))
        .map((e) => ({ entry: e, kind: classifyDocPath(e.path) }))
        .filter((c): c is { entry: TreeEntry; kind: DocKind } => c.kind !== null)
        .sort((a, b) => docPriority(a.entry.path, a.kind) - docPriority(b.entry.path, b.kind) || a.entry.path.localeCompare(b.entry.path));

      const documents: EvidenceDocument[] = [];
      let totalBytes = 0;
      let skipped = 0;
      let excludedForSecrets = 0;
      let linesRedacted = 0;
      for (const c of candidates) {
        if (documents.length >= EVIDENCE_LIMITS.documents || totalBytes >= EVIDENCE_LIMITS.totalDocumentBytes) {
          skipped += 1;
          truncated = true;
          continue;
        }
        const room = Math.min(EVIDENCE_LIMITS.documentBytes, EVIDENCE_LIMITS.totalDocumentBytes - totalBytes);
        const blob = await git.readBlob(repo.clonePath, idx.sourceSha, c.entry.path, room);
        if (blob.kind !== 'text' || !isReadableText(blob.text)) {
          skipped += 1;
          continue;
        }
        let text = c.kind === 'env_example' ? reduceEnvExample(blob.text) : blob.text;
        const screened = screenDocument(text);
        if (screened.action === 'exclude') {
          excludedForSecrets += 1;
          continue;
        }
        text = screened.text;
        linesRedacted += screened.redactedLines;
        const cut = truncateUtf8(text, room);
        totalBytes += Buffer.byteLength(cut.text, 'utf8');
        if (blob.truncated || cut.truncated) truncated = true;
        documents.push({ path: c.entry.path, kind: c.kind, text: cut.text, truncated: blob.truncated || cut.truncated });
      }

      // ---- excerpts from top-ranked source files (screened identically)
      const excerpts: EvidenceExcerpt[] = [];
      for (const path of facts.rankedFiles) {
        if (excerpts.length >= EVIDENCE_LIMITS.excerpts) break;
        if (!inventory.has(path) || !EXCERPT_EXT.test(path)) continue;
        const blob = await git.readBlob(repo.clonePath, idx.sourceSha, path, EVIDENCE_LIMITS.excerptBytes);
        if (blob.kind !== 'text' || !isReadableText(blob.text)) continue;
        const screened = screenDocument(blob.text);
        if (screened.action === 'exclude') {
          excludedForSecrets += 1;
          continue;
        }
        linesRedacted += screened.redactedLines;
        excerpts.push({ path, text: screened.text });
      }

      const symbols: EvidenceSymbol[] = facts.symbolRows
        .filter((s) => s.exported)
        .slice(0, EVIDENCE_LIMITS.symbols)
        .map((s) => ({ file: s.file, name: s.name, kind: s.kind, exported: s.exported }));

      const repoMap = facts.map.degraded || !facts.map.text ? null : facts.map.text.slice(0, EVIDENCE_LIMITS.repoMapChars);

      // Only cite paths that exist at the pinned commit.
      const rankedFiles = facts.rankedFiles.filter((p) => inventory.has(p) || tree.overflow);
      const criticalChains = facts.chains.filter((c) => c.every((p) => inventory.has(p) || tree.overflow));

      const report: EvidenceReport = {
        documents_used: documents.length,
        documents_skipped: skipped,
        excerpts_used: excerpts.length,
        ranked_files: rankedFiles.length,
        critical_chains: criticalChains.length,
        symbols: symbols.length,
        documents_excluded_for_secrets: excludedForSecrets,
        lines_redacted: linesRedacted,
        truncated,
        notes: notes.slice(0, 12),
      };

      const evidence: CapturedEvidence = {
        repoFullName: repo.fullName,
        sourceSha: idx.sourceSha,
        indexedAt: idx.indexedAt,
        indexerVersion: idx.indexerVersion,
        indexStatus: idx.indexStatus,
        documents,
        excerpts,
        rankedFiles,
        criticalChains,
        symbols,
        repoMap,
        pathInventory: inventory,
        report,
      };
      if (!hasUsableEvidence(evidence)) return { kind: 'unavailable', reason: 'no usable evidence at the indexed commit' };
      return { kind: 'captured', evidence };
    } catch (err) {
      if (err instanceof GitRevisionError) return { kind: 'unavailable', reason: err.reason };
      throw err;
    }
  }
}
