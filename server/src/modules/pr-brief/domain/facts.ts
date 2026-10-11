import type { BriefMissingInput, SmartDiffRole } from '@devdigest/shared';

/** Facts the model may see. Never contains diff code, hunks, patches or finding bodies (AC-17). */
export interface BriefFile {
  path: string;
  additions: number;
  deletions: number;
  role: SmartDiffRole;
}

export type FindingSeverity = 'CRITICAL' | 'WARNING' | 'SUGGESTION';

export interface BriefFinding {
  file: string;
  line: number;
  severity: FindingSeverity;
  title: string;
}

export interface BriefDocument {
  path: string;
  text: string;
  tokens: number;
}

export interface BriefIntentFact {
  summary: string;
  in_scope: string[];
  out_of_scope: string[];
}

export interface BriefBlastFact {
  summary: string;
  degraded: boolean;
  callerFiles: string[];
}

/** Everything the gatherer read, before the input bounds are applied. */
export interface BriefFacts {
  title: string;
  description: string;
  files: BriefFile[];
  findings: BriefFinding[];
  documents: BriefDocument[];
  intent?: BriefIntentFact;
  blast?: BriefBlastFact;
}

export type RoleTotals = Record<SmartDiffRole, { files: number; lines: number }>;

export interface OmittedInputs {
  description: boolean;
  files: number;
  callers: number;
  findings: number;
  documents: number;
}

/** Facts after the AC-33 bounds, as handed to the prompt. */
export interface BoundedFacts {
  title: string;
  description: string;
  files: BriefFile[];
  totalFiles: number;
  roleTotals: RoleTotals;
  callerFiles: string[];
  findings: BriefFinding[];
  documents: BriefDocument[];
  intent?: BriefIntentFact;
  blast?: BriefBlastFact;
  missing: BriefMissingInput[];
  omitted: OmittedInputs;
  /** true when the bounds dropped files, callers, findings or whole documents (AC-35). */
  partial: boolean;
}
