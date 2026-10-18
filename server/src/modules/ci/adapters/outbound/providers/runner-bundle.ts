import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunnerBundlePort } from '../../../application/ports/runner-bundle.js';

/**
 * Reads the ncc-built agent-runner bundle (`agent-runner/dist/index.js`) from
 * disk so the export use-case can commit it as `.devdigest/runner/index.js`
 * (AC-3 / R3). Resolution (simplest workable path):
 *   1. `DEVDIGEST_RUNNER_BUNDLE_PATH` env override, if set (absolute path).
 *   2. otherwise `<repo-root>/agent-runner/dist/index.js`, where repo root is
 *      derived from this module's location (…/server/src/modules/ci/… → up 6).
 * The bundle is a generated non-secret build artifact, not a credential, so a
 * filesystem read in an outbound adapter is appropriate. If the file is absent
 * (runner not built) the read throws and the use-case reports "export
 * unavailable" — the export produces nothing rather than a runner-less commit.
 */
export class FileRunnerBundle implements RunnerBundlePort {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly moduleDir: string = path.dirname(fileURLToPath(import.meta.url)),
  ) {}

  read(): string {
    return readFileSync(this.resolvePath(), 'utf8');
  }

  private resolvePath(): string {
    const override = this.env.DEVDIGEST_RUNNER_BUNDLE_PATH;
    if (override && override.trim().length > 0) return override;
    // …/server/src/modules/ci/adapters/outbound/providers → repo root is up 7.
    const repoRoot = path.resolve(this.moduleDir, '../../../../../../..');
    return path.join(repoRoot, 'agent-runner', 'dist', 'index.js');
  }
}
