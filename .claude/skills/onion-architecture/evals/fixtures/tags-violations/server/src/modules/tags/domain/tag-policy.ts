const RESERVED_TAGS = new Set(['internal', 'draft', 'deprecated']);

export function isReservedTag(name: string): boolean {
  return RESERVED_TAGS.has(name.toLowerCase());
}

export function sortTags(tags: string[]): string[] {
  return [...tags].sort((a, b) => a.localeCompare(b));
}
