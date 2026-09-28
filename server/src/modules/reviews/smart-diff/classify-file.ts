import type { SmartDiffRole } from '@devdigest/shared';
import { CLASSIFICATION_RULES, DEFAULT_SMART_DIFF_ROLE } from './constants.js';

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

/** Pure: path -> reviewer role. First matching rule wins; fallback is `core`. */
export function classifyFile(path: string): SmartDiffRole {
  const p = normalizePath(path);
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.patterns.some((re) => re.test(p))) return rule.role;
  }
  return DEFAULT_SMART_DIFF_ROLE;
}
