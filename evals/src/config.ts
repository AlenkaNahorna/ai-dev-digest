/**
 * All tunables in one place. No logic here — just the knobs the rest of the package reads.
 * Nothing in this module imports from another src module (it is the bottom of the dependency
 * graph): config knows nothing of runtime, scoring, or the SDK.
 */

// --- Models -----------------------------------------------------------------
// Cheap model under test by default; the judge is a stronger family to soften self-preference.
export const EVAL_MODEL = process.env.EVAL_MODEL ?? "claude-haiku-4-5";
export const EVAL_JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "openai/gpt-4.1-mini";
export const MAX_TURNS = Number(process.env.EVAL_MAX_TURNS ?? "8");
// Output cap per model call. OpenRouter reserves credits for the REQUESTED max (the Agent SDK asks
// for 32000), so an uncapped call can 402 while the balance is still positive.
export const MAX_OUTPUT_TOKENS = Number(process.env.EVAL_MAX_OUTPUT_TOKENS ?? "8000");

// --- Configuration tag ------------------------------------------------------
// "candidate" = artifact injected (normal). "baseline" = no artifact (benchmark lift baseline).
export const EVAL_CONFIG = process.env.EVAL_CONFIG ?? "candidate";
export const IS_BASELINE = EVAL_CONFIG === "baseline";

// --- Scoring / statistics thresholds ---------------------------------------
export const DEFAULT_THRESHOLD = 0.6; // judge score gate for a quality case
export const FLAKY_LOW = 0.2; // pass rate strictly inside (20%, 80%) is "flaky"
export const FLAKY_HIGH = 0.8;
export const COST_REGRESSION_RATIO = 1.25; // candidate mean tokens > 125% of baseline

// --- Tool allow-lists -------------------------------------------------------
// Subagent-spawning tool name varies by harness; count both.
export const SPAWN_TOOLS = new Set(["Task", "Agent"]);
// workflowTask runs against the LIVE repo with bypassPermissions — keep this read-only.
export const WORKFLOW_ALLOWED_TOOLS = ["Read", "Grep", "Glob", "Task", "Agent", "Skill"];
// `allowedTools` only AUTO-APPROVES tools; with permissionMode "bypassPermissions" every other tool is
// still available to the model. Task-management tools are the one that matters for workflow evals:
// weaker models answer "record this discovery" with TaskCreate instead of invoking the skill.
// Bash/Write/Edit are removed too: workflowTask runs against the LIVE repo, and CI traces showed the model
// writing a file (Write) and running Bash/Grep instead of engaging the skill. Read/Grep/Glob/Agent/Skill remain.
export const WORKFLOW_DISALLOWED_TOOLS = [
  "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "TodoWrite",
  "Bash", "Write", "Edit", "NotebookEdit",
];

// --- Output verbosity -------------------------------------------------------
// Set EVAL_QUIET to suppress per-run trace/verdict spam during multi-run aggregation.
export const QUIET = Boolean(process.env.EVAL_QUIET);
