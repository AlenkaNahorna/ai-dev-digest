import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (AGENTS.md/CLAUDE.md, module
 * INSIGHTS, skills, subagents; loaded via settingSources:["project"]) behaves as documented.
 * Organized by scenario, not by a single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 4 Claude sessions (each case is one session; a trace case stops as soon as all of its
 * expectations are met).
 *   - 2 × trace (merged scenarios: several assertions per session)  = 2
 *   - 1 × activation pair (positive + near-miss negative)           = 2
 *
 * Merging saves sessions but coarsens diagnostics: a trace case fails if ANY of its expectations
 * is missed, and the failure message lists what was read and dispatched. A merged trace is only
 * trusted after `pnpm eval:repeat workflow -t "<name>" -n 2` shows it is stable.
 *
 * Trace cases can also assert ABSENCE (forbidSubagents / forbidSkills / forbidFilesRead). Those are
 * checked only over the trace up to the early stop, so they prove "not before the positives were
 * met", which is the scoping property we care about here.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): session protocol + module docs + two subagents for an API task --------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    name: "API-route task reads server INSIGHTS and docs, dispatches architecture-reviewer and security-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Перед роботою за сесійним протоколом прочитай INSIGHTS модуля server, потім звірся " +
      "з архітектурними настановами server (AGENTS.md модуля) щодо DI, адаптерів і потоку запиту. " +
      "Потім ОБОВʼЯЗКОВО запусти два сабагенти: architecture-reviewer, щоб він оцінив мій план на " +
      "відповідність onion-шарам, і security-reviewer, бо endpoint віддає ревʼю і має перевіряти доступ " +
      "по workspace. Не рецензуй сам.",
    // The prompt tells the model to check server AGENTS.md (not docs/architecture.md), so expect that file (server/CLAUDE.md is a symlink to it, so either path counts).
    expectFilesRead: ["server/INSIGHTS.md", "server/AGENTS.md|server/CLAUDE.md"],
    expectSubagents: ["architecture-reviewer", "security-reviewer"],
    // The request is to PLAN an endpoint, not implement it: no implementer dispatch.
    forbidSubagents: ["implementer"],
    maxTurns: 10,
  },

  // --- trace (1 session): module INSIGHTS + module routing doc for a reviewer-core change ---------
  {
    kind: "trace",
    name: "reviewer-core change reads the module INSIGHTS and the architecture doc",
    prompt:
      "Я збираюся змінити review pipeline у reviewer-core. Перш ніж торкатися коду: " +
      "(1) за сесійним протоколом прочитай INSIGHTS модуля reviewer-core; " +
      "(2) звірся з AGENTS.md модуля щодо того, яку документацію треба прочитати для змін у pipeline, " +
      "і прочитай саме ці документи.",
    expectFilesRead: ["reviewer-core/INSIGHTS.md", "reviewer-core/docs/architecture.md"],
    // Scope check: the change is in reviewer-core, so no other module's INSIGHTS should be read.
    forbidFilesRead: ["client/INSIGHTS.md", "e2e/INSIGHTS.md", "mcp/INSIGHTS.md"],
    maxTurns: 8,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    // 6, not 4: at 4 turns the session hit max-turns, so the negative was not reached cleanly.
    maxTurns: 6,
  },
];
