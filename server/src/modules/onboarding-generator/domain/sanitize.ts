/**
 * Output sanitization for model-produced text that is stored and may later be
 * published on an anonymous page. The client renders Markdown without raw HTML
 * and validates URL schemes again at render time; this is the first of two
 * independent defences (the public screen has no third).
 */

const SAFE_SCHEMES = /^(?:https?:|mailto:)/i;

/**
 * Replace Markdown links/images/autolinks whose target is not an http(s)/mailto
 * URL (javascript:, data:, vbscript:, file:, protocol-relative `//host`, …) with
 * their visible text. Relative in-page anchors (`#x`) are kept.
 */
export function stripUnsafeLinks(text: string): string {
  const keep = (target: string): boolean => {
    const t = target.trim().replace(/^<|>$/g, '');
    if (t.startsWith('#')) return true;
    return SAFE_SCHEMES.test(t);
  };
  // [text](target) and ![alt](target)
  let out = text.replace(/(!?)\[([^\]]*)\]\(\s*([^)]*?)\s*\)/g, (_m, bang: string, label: string, target: string) =>
    keep(target) ? `${bang}[${label}](${target})` : label,
  );
  // <scheme:...> autolinks
  out = out.replace(/<\s*([a-z][a-z0-9+.-]*:[^>\s]*)\s*>/gi, (_m, target: string) =>
    keep(target) ? `<${target}>` : '',
  );
  // reference-style definitions: [id]: target
  out = out.replace(/^\s*\[[^\]]+\]:\s*(\S+).*$/gim, (m, target: string) => (keep(target) ? m : ''));
  return out;
}

/** Collapse to one printable line (used for commands and short labels). */
export function toSingleLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Clamp to `max` characters (adding an ellipsis when cut). */
export function clamp(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Neutralize case/whitespace variants of an untrusted-block delimiter (insights: reviewer-core 2026-10-11). */
export function neutralizeDelimiters(text: string): string {
  return text.replace(/<\s*\/?\s*untrusted[a-z_ -]*>/gi, '[removed delimiter]');
}
