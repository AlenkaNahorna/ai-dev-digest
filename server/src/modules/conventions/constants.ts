/**
 * conventions — literals for the extraction pipeline (L02).
 */

/** Config files read whole (best-effort — a missing one is just skipped). */
export const CONFIG_FILE_PATHS = [
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc',
  'eslint.config.js',
  'eslint.config.mjs',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.cjs',
];

/** Top-N ranked source files sampled via `repoIntel.getConventionSamples`. */
export const SAMPLE_FILE_COUNT = 12;

/** Per-file character cap before a sample is handed to the model (token budget). */
export const MAX_FILE_CHARS = 4000;
