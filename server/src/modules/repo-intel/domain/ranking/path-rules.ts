/** Pure deterministic path policy used by ranking-based samples. */
export const JUNK_PATH_PATTERNS = [
  '.test.', '.spec.', '.d.ts', '__tests__/', '__mocks__/', '/test/', '/tests/', '/migrations/',
  '/__fixtures__/', '.config.', 'vitest.', 'jest.', 'eslint', 'prettier',
] as const;

export function isJunkPath(path: string): boolean {
  const lower = path.toLowerCase();
  return JUNK_PATH_PATTERNS.some((pattern) => lower.includes(pattern));
}
