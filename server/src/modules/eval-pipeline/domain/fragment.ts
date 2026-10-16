/**
 * Slice one file's diff out of a raw unified diff, keeping only the hunks that
 * intersect the finding's new-side lines (AC-4). Falls back to the whole file
 * diff when no hunk intersects. Returns `undefined` when the file is absent.
 */

interface Section {
  path: string;
  header: string[];
  hunks: { newStart: number; newEnd: number; lines: string[] }[];
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function cleanPath(p: string): string {
  return p.replace(/^[ab]\//, '').trim();
}

function parseSections(raw: string): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  let hunk: Section['hunks'][number] | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git')) {
      const m = line.match(/ b\/(.+)$/);
      cur = { path: m?.[1] ? m[1].trim() : '', header: [line], hunks: [] };
      hunk = null;
      sections.push(cur);
      continue;
    }
    if (!cur) continue;
    const hh = line.match(HUNK_RE);
    if (hh) {
      const start = Number(hh[1]);
      const len = hh[2] !== undefined ? Number(hh[2]) : 1;
      hunk = { newStart: start, newEnd: start + Math.max(len, 1) - 1, lines: [line] };
      cur.hunks.push(hunk);
      continue;
    }
    if (hunk) {
      hunk.lines.push(line);
    } else {
      if (line.startsWith('+++ ')) {
        const p = cleanPath(line.slice(4));
        if (p !== '/dev/null') cur.path = p;
      }
      cur.header.push(line);
    }
  }
  return sections;
}

export function extractFileFragment(
  raw: string,
  file: string,
  startLine: number,
  endLine: number,
): string | undefined {
  const want = cleanPath(file.replace(/^\.\//, ''));
  const section = parseSections(raw).find((s) => s.path === want);
  if (!section) return undefined;
  const lo = Math.min(startLine, endLine);
  const hi = Math.max(startLine, endLine);
  const picked = section.hunks.filter((h) => h.newStart <= hi && lo <= h.newEnd);
  const hunks = picked.length > 0 ? picked : section.hunks;
  const body = [...section.header, ...hunks.flatMap((h) => h.lines)].join('\n').replace(/\n+$/, '');
  return `${body}\n`;
}
