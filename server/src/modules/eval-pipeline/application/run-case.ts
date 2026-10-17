import type { EvalActualOutput, EvalExpectation } from '@devdigest/shared';
import { scoreCase, type CaseScore } from '../domain/scoring.js';
import type { AgentInfo, AgentRunnerPort, EvalLogPort } from './ports/eval-ports.js';

export function safeMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').slice(0, 200);
}

export interface ExecutedCase {
  score: CaseScore;
  output: EvalActualOutput;
  costUsd: number | null;
}

/**
 * Run the agent once on one diff and score it against one expectation (AC-14, AC-22).
 * Shared by "Run all evals" and the modal's "Run case". A model failure never throws:
 * it becomes an errored score (counts as a miss) so one case cannot break a batch.
 */
export async function executeCase(
  runner: AgentRunnerPort,
  agent: AgentInfo,
  diff: string,
  expectation: EvalExpectation,
  log?: EvalLogPort,
  opts?: { skills?: string[] },
): Promise<ExecutedCase> {
  const scored = {
    kind: expectation.kind,
    file: expectation.file,
    startLine: expectation.start_line,
    endLine: expectation.end_line,
  };
  try {
    const result = await runner.run(agent, diff, opts);
    const score = scoreCase({
      expectation: scored,
      kept: result.kept.map((f) => ({ file: f.file, startLine: f.startLine, endLine: f.endLine })),
      droppedCount: result.droppedCount,
    });
    return {
      score,
      costUsd: result.costUsd,
      output: {
        emitted: score.emitted,
        kept: score.kept,
        dropped: score.dropped,
        hits: score.hits,
        noise: score.noise,
        findings: result.kept.map((f) => ({
          file: f.file,
          start_line: f.startLine,
          end_line: f.endLine,
          title: f.title,
          severity: f.severity,
        })),
      },
    };
  } catch (err) {
    log?.warn('eval: case run failed', {});
    return {
      score: scoreCase({ expectation: scored, kept: [], droppedCount: 0, errored: true }),
      costUsd: null,
      output: { emitted: 0, kept: 0, dropped: 0, hits: 0, noise: 0, findings: [], error: safeMessage(err) },
    };
  }
}
