/**
 * Kebab-case slug of a skill name, used to name `.devdigest/skills/<slug>.md`
 * files and the slug entries in the manifest's `skills` list. Pure, dependency
 * free (domain layer). Deduped against already-taken slugs so two skills with
 * names that collapse to the same slug ("Security!" / "security") stay distinct.
 */
export function slugify(name: string, max = 64): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'skill';
}

/** `slug`, then `slug-2`, `slug-3`, … — unique within `taken` (mutated). */
export function uniqueSlug(name: string, taken: Set<string>): string {
  const base = slugify(name);
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}
