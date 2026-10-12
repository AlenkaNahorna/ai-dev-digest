/** Why a document's text cannot be injected into a prompt. */
export type UnusableReason = 'empty' | 'non_utf8';

/**
 * Whether decoded document text is usable as prompt context. The clone is read
 * as UTF-8 by the Git adapter, which substitutes U+FFFD for invalid sequences
 * (and binary files carry NUL), so either marker means "not valid UTF-8 text".
 */
export function unusableReason(text: string): UnusableReason | undefined {
  if (text.includes('�') || text.includes('\0')) return 'non_utf8';
  if (text.trim().length === 0) return 'empty';
  return undefined;
}
