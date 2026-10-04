/**
 * Make an untrusted string safe to echo inside a one-line message: control
 * characters (incl. newlines) become spaces, whitespace is trimmed, and the
 * result is cut to `max` characters (ending with an ellipsis when cut).
 */
export function clipText(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1))}…`;
}
