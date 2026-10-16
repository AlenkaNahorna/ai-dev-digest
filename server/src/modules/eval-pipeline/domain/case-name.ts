/** Case names are short slugs of the finding title (e.g. `hardcoded-stripe-secret-key`). */
export function slugify(title: string, max = 48): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'case';
}

/** Unique among `taken`: `slug`, then `slug-l<line>`, then `slug-l<line>-2`, … */
export function uniqueCaseName(title: string, startLine: number, taken: ReadonlySet<string>): string {
  const base = slugify(title);
  if (!taken.has(base)) return base;
  const withLine = `${base}-l${startLine}`;
  if (!taken.has(withLine)) return withLine;
  for (let i = 2; ; i += 1) {
    const candidate = `${withLine}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
