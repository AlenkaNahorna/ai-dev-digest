import type { CapturedEvidence } from '../../src/modules/onboarding-generator/domain/evidence.js';
import type { ModelTourOutput } from '../../src/modules/onboarding-generator/domain/model-output.js';

export const SHA = 'a'.repeat(40);

export function evidence(over: Partial<CapturedEvidence> = {}): CapturedEvidence {
  const inventory = new Set(['src/app.ts', 'src/db.ts', 'src/routes.ts', 'README.md', 'package.json']);
  return {
    repoFullName: 'acme/payments-api',
    sourceSha: SHA,
    indexedAt: new Date('2026-10-11T10:00:00Z'),
    indexerVersion: 3,
    indexStatus: 'full',
    documents: [
      { path: 'README.md', kind: 'readme', text: '# Payments\n\nRun `pnpm dev` to start.\n', truncated: false },
      { path: 'package.json', kind: 'manifest', text: JSON.stringify({ scripts: { dev: 'tsx watch', test: 'vitest' } }), truncated: false },
    ],
    excerpts: [],
    rankedFiles: ['src/app.ts', 'src/routes.ts', 'src/db.ts'],
    criticalChains: [['src/app.ts', 'src/routes.ts', 'src/db.ts']],
    symbols: [{ file: 'src/app.ts', name: 'buildApp', kind: 'function', exported: true }],
    repoMap: null,
    pathInventory: inventory,
    report: {
      documents_used: 2, documents_skipped: 0, excerpts_used: 0, ranked_files: 3, critical_chains: 1, symbols: 1,
      documents_excluded_for_secrets: 0, lines_redacted: 0, truncated: false, notes: [],
    },
    ...over,
  };
}

export function model(over: Partial<ModelTourOutput> = {}): ModelTourOutput {
  return {
    architecture: {
      unavailable_reason: null,
      summary: 'A Fastify API that routes requests to a database layer.',
      diagram_nodes: [
        { id: 'app', label: 'App', kind: 'service', path: 'src/app.ts' },
        { id: 'routes', label: 'Routes', kind: 'module', path: 'src/routes.ts' },
        { id: 'db', label: 'DB', kind: 'datastore', path: 'src/db.ts' },
      ],
      diagram_edges: [
        { from: 'app', to: 'routes', label: null },
        { from: 'routes', to: 'db', label: null },
      ],
    },
    critical_paths: { unavailable_reason: null, entries: [{ path: 'src/app.ts', role: 'Entry point' }] },
    local_run: {
      unavailable_reason: null,
      steps: [{ order: 1, instruction: 'Start the dev server', command: 'pnpm dev', source: 'README.md' }],
    },
    reading_path: { unavailable_reason: null, entries: [{ order: 1, path: 'src/app.ts', reason: 'Start here' }] },
    first_tasks: {
      unavailable_reason: null,
      tasks: [{ title: 'Add a route', description: 'Add a health route', files: ['src/routes.ts'], outcome: 'Route responds' }],
    },
    ...over,
  };
}

