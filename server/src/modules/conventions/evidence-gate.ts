import type { ConventionCandidateDraft } from '@devdigest/shared';

/**
 * Evidence-gate — the same idea as reviewer-core's grounding gate
 * (reviewer-core/src/review/ground.ts), applied to convention candidates
 * instead of review findings: a candidate is only as good as its citation, so
 * we re-check every citation against the ACTUAL sampled file content before a
 * candidate is ever persisted or shown. No model call here — pure string work.
 *
 * A candidate is dropped when:
 *   - its evidence_path isn't one of the files we actually sampled, or
 *   - its line range is out of bounds / inverted, or
 *   - its evidence_snippet doesn't actually appear (whitespace aside) inside
 *     that cited line range — catches a plausible-looking but hallucinated
 *     quote even when the file/line coordinates happen to be valid.
 */
export function passesEvidenceGate(
  candidate: ConventionCandidateDraft,
  fileContentByPath: ReadonlyMap<string, string>,
): boolean {
  const content = fileContentByPath.get(candidate.evidence_path);
  if (content == null) return false;

  const lines = content.split('\n');
  const { evidence_line_start: start, evidence_line_end: end } = candidate;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 1 || end < start || end > lines.length) return false;

  const cited = normalize(lines.slice(start - 1, end).join('\n'));
  const snippet = normalize(candidate.evidence_snippet);
  if (!snippet) return false;

  // Either direction counts: the model may quote the whole cited block, or
  // just its most relevant line(s) within a wider cited range.
  return cited.includes(snippet) || snippet.includes(cited);
}

function normalize(text: string): string {
  return text
    .split('\n')
    // Defensive: the model is shown source with "N| " line-number prefixes
    // (see prompt.ts numberLines) and a weaker model sometimes copies that
    // prefix straight into evidence_snippet. Strip it per line before
    // comparing so a real, otherwise-correct quote isn't dropped over a
    // formatting artifact the model picked up from the prompt, not the file.
    .map((line) => line.replace(/^\s*\d+\|\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
