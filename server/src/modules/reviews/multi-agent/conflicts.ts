import type { Conflict, ConflictTake, Severity } from '@devdigest/shared';
import { LINE_TOLERANCE } from './constants.js';

/**
 * Pure "Where agents disagree" computation (AC-29..AC-34, D3). No DB/Fastify
 * imports. Conflicts are derived from persisted findings on read, never stored.
 *
 * A location (file:line) is contended when at least one agent flagged it. For
 * each reviewing agent the take is:
 *   - its highest severity at that location, if it flagged;
 *   - 'ignored' if its run COMPLETED but it did not flag;
 *   - 'no_result' if its run failed / is still running (AC-31: neither creates
 *     nor resolves a conflict).
 * A conflict (`is_conflict: true`) = at least one agent flagged AND at least one
 * COMPLETED agent did not (verdict 'ignored'), OR two flagging agents'
 * severities differ by >= 2 levels. Flagged locations where everyone agreed are
 * still listed, with `is_conflict: false`. The "did not flag" note is neutral derived text (AC-34) — no model
 * output.
 */

/** Severity ordinal for the ">= 2 levels apart" test. Higher = worse. */
const SEVERITY_LEVEL: Record<Severity, number> = {
  SUGGESTION: 0,
  WARNING: 1,
  CRITICAL: 2,
};

export type ConflictAgent = {
  agentId: string;
  agentName: string;
  /** 'done' agents can be "did not flag"; others are 'no_result' (AC-31). */
  completed: boolean;
  findings: { file: string; line: number; title: string; severity: Severity }[];
};

type LocationKey = string;
const keyOf = (file: string, line: number): LocationKey => `${file}:${line}`;

/** Group an agent's findings by (file, line within LINE_TOLERANCE is NOT merged
 *  here — conflicts key on the exact flagged line, matching the contract). */
function highestSeverityAt(
  agent: ConflictAgent,
  file: string,
  line: number,
): { severity: Severity; title: string } | undefined {
  let best: { severity: Severity; title: string } | undefined;
  for (const f of agent.findings) {
    if (f.file !== file) continue;
    if (Math.abs(f.line - line) > LINE_TOLERANCE) continue;
    if (!best || SEVERITY_LEVEL[f.severity] > SEVERITY_LEVEL[best.severity]) {
      best = { severity: f.severity, title: f.title };
    }
  }
  return best;
}

export function computeConflicts(agents: ConflictAgent[]): Conflict[] {
  // Candidate locations = every flagged (file, line). Deterministic order:
  // first appearance across agents (agent order, then finding order).
  const locations: { file: string; line: number; title: string }[] = [];
  const seen = new Set<LocationKey>();
  for (const agent of agents) {
    for (const f of agent.findings) {
      const k = keyOf(f.file, f.line);
      if (seen.has(k)) continue;
      seen.add(k);
      locations.push({ file: f.file, line: f.line, title: f.title });
    }
  }

  const conflicts: Conflict[] = [];
  for (const loc of locations) {
    const takes: ConflictTake[] = [];
    const flaggedLevels: number[] = [];
    let anyFlagged = false;
    let anyCompletedIgnored = false;

    for (const agent of agents) {
      const hit = highestSeverityAt(agent, loc.file, loc.line);
      if (hit) {
        anyFlagged = true;
        flaggedLevels.push(SEVERITY_LEVEL[hit.severity]);
        takes.push({
          agent_id: agent.agentId,
          persona: agent.agentName,
          verdict: hit.severity,
          note: hit.title,
        });
      } else if (agent.completed) {
        anyCompletedIgnored = true;
        takes.push({
          agent_id: agent.agentId,
          persona: agent.agentName,
          verdict: 'ignored',
          note: `No finding reported by ${agent.agentName} at this location`,
        });
      } else {
        // Failed / running: no_result — neither creates nor resolves a conflict.
        takes.push({
          agent_id: agent.agentId,
          persona: agent.agentName,
          verdict: 'no_result',
          note: `No result from ${agent.agentName} (run did not complete)`,
        });
      }
    }

    const severitySpread =
      flaggedLevels.length >= 2 && Math.max(...flaggedLevels) - Math.min(...flaggedLevels) >= 2;
    const isConflict = (anyFlagged && anyCompletedIgnored) || severitySpread;
    // Every flagged location is returned; `is_conflict` lets the UI's "Show only
    // conflicts" toggle hide the ones where all reviewing agents agreed (AC-33).
    conflicts.push({ file: loc.file, line: loc.line, title: loc.title, is_conflict: isConflict, takes });
  }
  return conflicts;
}
