import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Provider } from '@devdigest/shared';
import type { Container } from '../../../../../platform/container.js';
import { parseUnifiedDiff } from '../../../../../adapters/git/diff-parser.js';
import { SkillsService } from '../../../../skills/service.js';
import type { AgentInfo, AgentRunnerPort, RunnerResult } from '../../../application/ports/eval-ports.js';

/** Fixed task line for every eval run (AC-15) so two batches differ only by agent config. */
export const EVAL_TASK_LINE = 'Review this pull request diff fragment.';

/**
 * Runs ONE agent on ONE diff fragment through the same engine as a real review
 * (`reviewPullRequest`: prompt → model → citation-grounding gate). Only the
 * agent's own config (system prompt, model, linked skills) varies; memory,
 * project context, callers, repo map, PR text and intent are never sent (AC-14).
 */
export class ReviewerCoreRunner implements AgentRunnerPort {
  private readonly skills: SkillsService;

  constructor(private container: Container) {
    this.skills = new SkillsService(container);
  }

  async run(agent: AgentInfo, diffText: string, opts?: { skills?: string[] }): Promise<RunnerResult> {
    const llm = await this.container.llm(agent.provider as Provider);
    const skills = opts?.skills ?? (await this.skills.promptSkills(agent.id));
    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff: parseUnifiedDiff(diffText),
      llm,
      strategy: 'single-pass',
      skills,
      task: EVAL_TASK_LINE,
    });
    return {
      kept: outcome.review.findings.map((f) => ({
        file: f.file,
        startLine: f.start_line,
        endLine: f.end_line,
        title: f.title,
        severity: f.severity,
      })),
      droppedCount: outcome.dropped.length,
      costUsd: outcome.costUsd,
    };
  }
}
