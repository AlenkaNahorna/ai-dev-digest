import { describe, it, expect } from 'vitest';
import type { SmartDiffRole } from '@devdigest/shared';
import { classifyFile } from '../src/modules/reviews/smart-diff/classify-file.js';

/** Table: path -> role. First matching rule wins (boilerplate > tests > wiring > docs > core). */
const TABLE: [string, SmartDiffRole][] = [
  // Disputed cases (decisions pinned):
  // (a) snapshot rule sits ABOVE the tests rule
  ['client/src/__tests__/__snapshots__/x.snap', 'boilerplate'],
  // (b) .claude/** (agent behaviour) sits ABOVE the docs rule
  ['.claude/skills/security/SKILL.md', 'wiring'],
  // (c) e2e/** sits ABOVE the docs rule
  ['e2e/README.md', 'tests'],
  // boilerplate
  ['pnpm-lock.yaml', 'boilerplate'],
  ['package-lock.json', 'boilerplate'],
  ['yarn.lock', 'boilerplate'],
  ['foo.lock', 'boilerplate'],
  ['dist/a.js', 'boilerplate'],
  ['build/out.js', 'boilerplate'],
  // decision: nested dist/build are boilerplate too
  ['packages/x/dist/foo.js', 'boilerplate'],
  ['src/api.generated.ts', 'boilerplate'],
  ['public/app.min.js', 'boilerplate'],
  // tests
  ['server/src/foo.test.ts', 'tests'],
  ['server/test/foo.it.test.ts', 'tests'],
  ['server/src/foo.spec.ts', 'tests'],
  ['client/src/x.test.tsx', 'tests'],
  ['server/test/helpers/pg.ts', 'tests'],
  ['client/src/__tests__/util.ts', 'tests'],
  ['e2e/specs/05-pr-diff.flow.json', 'tests'],
  // wiring
  ['server/src/modules/index.ts', 'wiring'],
  ['src/api/public/index.js', 'wiring'],
  ['next.config.mjs', 'wiring'],
  ['vitest.config.ts', 'wiring'],
  ['tsconfig.base.json', 'wiring'],
  ['.eslintrc.json', 'wiring'],
  ['.env.example', 'wiring'],
  ['docker-compose.override.yml', 'wiring'],
  ['.github/workflows/ci.yml', 'wiring'],
  // docs
  ['README.md', 'docs'],
  ['readme.md', 'docs'],
  ['docs/plans/x.md', 'docs'],
  ['CHANGELOG.md', 'docs'],
  ['LICENSE', 'docs'],
  ['server/README.md', 'docs'],
  // core
  ['server/src/modules/reviews/service.ts', 'core'],
  ['client/src/lib/api.ts', 'core'],
  // decision: package.json matches no rule -> core
  ['package.json', 'core'],
  // normalization
  ['server\\src\\foo.test.ts', 'tests'],
  ['./pnpm-lock.yaml', 'boilerplate'],
  ['/README.md', 'docs'],
];

describe('classifyFile', () => {
  it.each(TABLE)('%s -> %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it('is linear on hostile long paths', () => {
    const t = Date.now();
    classifyFile('a/'.repeat(50_000) + 'x');
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
