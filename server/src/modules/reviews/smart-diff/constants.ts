import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Display / group order of the Smart Diff (reviewer reading order).
 * NOT the evaluation order: see CLASSIFICATION_RULES below.
 */
export const SMART_DIFF_ROLE_ORDER = [
  'core',
  'tests',
  'wiring',
  'docs',
  'boilerplate',
] as const satisfies readonly SmartDiffRole[];

/** Role for every path that no rule matches. */
export const DEFAULT_SMART_DIFF_ROLE = 'core' as const satisfies SmartDiffRole;

export interface ClassificationRule {
  readonly role: Exclude<SmartDiffRole, 'core'>;
  readonly patterns: readonly RegExp[];
}

/**
 * Evaluated top to bottom, FIRST MATCH WINS. The order is a decision:
 *  - boilerplate above tests: `__tests__/__snapshots__/x.snap` is a snapshot.
 *  - tests above wiring/docs: `e2e/README.md` is treated as part of e2e (tests).
 *  - wiring above docs: `.claude/skills/x/SKILL.md` configures agent behaviour,
 *    so it is wiring, not documentation.
 *  - nested `dist/` and `build/` directories are boilerplate too (not only root).
 *  - `package.json` matches nothing here on purpose: it stays `core`.
 *
 * All patterns are anchored, linear-time RegExps over a normalized path
 * (forward slashes, no leading `./` or `/`); paths are attacker-controlled.
 */
export const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    role: 'boilerplate',
    patterns: [
      /(^|\/)[^/]*\.lock$/,
      /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/,
      /(^|\/)(dist|build)\//,
      /(^|\/)__snapshots__\//,
      /\.snap$/,
      /\.generated\./,
      /\.min\.js$/,
    ],
  },
  {
    role: 'tests',
    patterns: [
      /\.(test|spec)\.[cm]?[jt]sx?$/,
      /(^|\/)(test|tests|__tests__)\//,
      /^e2e\//,
    ],
  },
  {
    role: 'wiring',
    patterns: [
      /(^|\/)index\.(ts|js)$/,
      /\.config\.[^/]+$/,
      /(^|\/)tsconfig[^/]*\.json$/,
      /(^|\/)\.eslintrc[^/]*$/,
      /(^|\/)\.env[^/]*$/,
      /(^|\/)docker-compose[^/]*\.ya?ml$/,
      /^\.github\//,
      /^\.claude\//,
    ],
  },
  {
    role: 'docs',
    patterns: [
      /\.mdx?$/i,
      /^docs\//,
      /(^|\/)README[^/]*$/i,
      /(^|\/)CHANGELOG[^/]*$/i,
      /(^|\/)LICENSE$/i,
    ],
  },
];
