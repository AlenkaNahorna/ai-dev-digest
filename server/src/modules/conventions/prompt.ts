import type { ChatMessage } from '@devdigest/shared';

/**
 * System prompt for the conventions extractor — a single completeStructured
 * call over the sampled files (no map-reduce, no tool use). Deliberately
 * strict about evidence: every candidate is re-verified against the actual
 * file contents afterwards (see evidence-gate.ts), so a candidate that cites
 * a real-looking but wrong file/line is dropped before it ever reaches the UI.
 */
const SYSTEM_PROMPT = `You are a senior engineer auditing a codebase for its own HOUSE conventions —
patterns this specific project follows that a new contributor would need to
learn (naming, structure, testing, error handling, API contracts), not
generic language or framework advice.

Rules:
- Only report a convention you can prove with a REAL excerpt from the files
  given below. Never invent a rule, a file path, or a line number.
- Every candidate must cite the exact 1-based start/end line range and an
  "evidence_snippet" copied verbatim (whitespace aside) from those lines, in
  the file at "evidence_path" exactly as it is printed below.
- The source below is shown with "N| " line-number prefixes so you can cite
  exact lines — those prefixes are NOT part of the file. Never include them
  (or the "| " separator) in "evidence_snippet"; copy only the code itself.
- A convention repeated across two or more files is stronger evidence, but a
  single clear, well-evidenced pattern in one file is still worth reporting —
  give it a lower "confidence" rather than skipping it entirely.
- "category" is one of: naming, structure, testing, error-handling,
  api-contract, other.
- "confidence" is your own calibrated 0..1 estimate of how consistently the
  rule is followed across the sample — not a fixed constant.
- Skip anything that is just "uses TypeScript" / "uses React" / stock
  language advice — only conventions specific to THIS project's own choices.
- Aim for at least a few candidates when the sample supports it: look at
  naming (files, functions, variables), how errors/results are returned,
  how tests are structured, and any repeated shape in exports or module
  layout — not just the first obvious thing you notice.
- Return between 0 and 12 candidates. 0 is only correct when the sample
  truly has nothing citable — treat it as a last resort, not a safe default.`;

export interface SampledFile {
  path: string;
  content: string;
}

export function buildExtractionMessages(input: {
  repoFullName: string;
  configFiles: SampledFile[];
  sourceFiles: SampledFile[];
}): ChatMessage[] {
  const configSection = input.configFiles.length
    ? input.configFiles.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')
    : '(no recognizable lint/format/tsconfig files found)';
  const sourceSection = input.sourceFiles
    .map((f) => `### ${f.path}\n\`\`\`\n${numberLines(f.content)}\n\`\`\``)
    .join('\n\n');

  const user = `Repository: ${input.repoFullName}

## Config files

${configSection}

## Sample source files (line-numbered "N| ...")

${sourceSection}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

function numberLines(content: string): string {
  return content
    .split('\n')
    .map((line, i) => `${i + 1}| ${line}`)
    .join('\n');
}
