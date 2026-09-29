import type { SmartDiffRole } from "@devdigest/shared";

/** Groups that start collapsed; the rest are expanded. */
export const DEFAULT_COLLAPSED_ROLES: readonly SmartDiffRole[] = ["docs", "boilerplate"];

/** Every Smart Diff category, in the order displayed on the PR page. */
export const SMART_DIFF_ROLE_ORDER = ["core", "tests", "wiring", "docs", "boilerplate"] as const satisfies readonly SmartDiffRole[];
