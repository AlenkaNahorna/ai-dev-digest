#!/usr/bin/env node
/* verify:l06 — L06 Eval Pipeline gate.
   1. SDD artefacts: specs/eval-pipeline.md (+ acceptance criteria) and the plan exist.
   2. Scoring is code-only: domain/scoring.ts imports nothing and never touches an LLM.
   3. Server: typecheck, architecture:check, eval tests.
   4. Client: typecheck, eval tests.
   5. Dataset gate (needs Postgres): ≥ 8 eval cases for an agent, both must_find and must_not_flag present.
      Without a reachable DATABASE_URL this gate is SKIPPED loudly; set VERIFY_L06_STRICT=1 to make that a failure.
   Exit code 0 only if everything that ran is green. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.env.VERIFY_L06_STRICT === "1";
const results = [];
const record = (name, status, detail = "") => {
  results.push({ name, status, detail });
  const icon = status === "pass" ? "✓" : status === "skip" ? "○" : "✗";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
};

function run(name, cmd, args, cwd) {
  console.log(`\n▶ ${name}: ${cmd} ${args.join(" ")}  (${cwd.replace(root, ".") || "."})`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  record(name, r.status === 0 ? "pass" : "fail", r.status === 0 ? "" : `exit ${r.status ?? r.signal}`);
}

// 1. SDD artefacts ---------------------------------------------------------
const specPath = join(root, "specs/eval-pipeline.md");
if (!existsSync(specPath)) record("spec exists", "fail", "specs/eval-pipeline.md is missing");
else {
  const spec = readFileSync(specPath, "utf8");
  const acs = spec.match(/\bAC-\d+/g) ?? [];
  record("spec has acceptance criteria", new Set(acs).size >= 8 ? "pass" : "fail", `${new Set(acs).size} distinct AC ids`);
}
const plans = existsSync(join(root, "docs/plans")) ? readdirSync(join(root, "docs/plans")).filter((f) => f.includes("eval-pipeline")) : [];
record("plan exists", plans.length > 0 ? "pass" : "fail", plans[0] ?? "docs/plans/*eval-pipeline*.md missing");

// 2. Scoring is code-only --------------------------------------------------
const scoringDir = join(root, "server/src/modules/eval-pipeline/domain");
let offenders = [];
for (const f of existsSync(scoringDir) ? readdirSync(scoringDir).filter((x) => x.endsWith(".ts")) : []) {
  const src = readFileSync(join(scoringDir, f), "utf8");
  const bad = [...src.matchAll(/^\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/gm)]
    .map((m) => m[1])
    .filter((p) => !p.startsWith("./") || /llm|provider|openai|anthropic/i.test(p));
  if (/\.(complete|chat|generate)\s*\(|\bllm\b/i.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))) bad.push("LLM call");
  if (bad.length) offenders.push(`${f}: ${bad.join(", ")}`);
}
record("scoring makes no LLM call (domain is pure)", offenders.length === 0 && existsSync(scoringDir) ? "pass" : "fail", offenders.join("; "));

// 3. Server ---------------------------------------------------------------
const server = join(root, "server");
const evalTests = ["test/eval-scoring.test.ts", "test/eval-fragment.test.ts", "test/eval-use-cases.test.ts", "test/eval-skill.test.ts"];
run("server typecheck", "pnpm", ["typecheck"], server);
run("server architecture:check", "pnpm", ["architecture:check"], server);
run("server eval tests", "pnpm", ["exec", "vitest", "run", ...evalTests], server);

// 4. Client ---------------------------------------------------------------
const client = join(root, "client");
run("client typecheck", "pnpm", ["typecheck"], client);
run("client eval tests", "pnpm", ["exec", "vitest", "run", "src/features/evals", "FindingCard"], client);

// 5. Dataset gate ----------------------------------------------------------
const url = process.env.DATABASE_URL ?? readEnvUrl();
function readEnvUrl() {
  for (const p of [join(server, ".env"), join(root, ".env")]) {
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(/^DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}
if (!url) {
  record("dataset: ≥ 8 cases, both kinds", strict ? "fail" : "skip", "no DATABASE_URL");
} else {
  const probe = `
    import postgres from "postgres";
    const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
    try {
      const rows = await sql\`select owner_id, count(*)::int as n,
        count(*) filter (where expected_output->>'kind' = 'must_find')::int as must_find,
        count(*) filter (where expected_output->>'kind' = 'must_not_flag')::int as must_not_flag
        from eval_cases where owner_kind = 'agent' group by owner_id order by n desc limit 1\`;
      console.log(JSON.stringify(rows[0] ?? null));
    } finally { await sql.end(); }`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: server, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8",
  });
  if (r.status !== 0) {
    record("dataset: ≥ 8 cases, both kinds", strict ? "fail" : "skip", `database unreachable (${(r.stderr || "").trim().split("\n").pop()})`);
  } else {
    const row = JSON.parse(r.stdout.trim().split("\n").pop());
    const ok = row && row.n >= 8 && row.must_find > 0 && row.must_not_flag > 0;
    record("dataset: ≥ 8 cases, both kinds", ok ? "pass" : "fail",
      row ? `${row.n} cases (${row.must_find} must_find / ${row.must_not_flag} must_not_flag)` : "no eval cases yet");
  }
}

// Summary -------------------------------------------------------------------
const failed = results.filter((r) => r.status === "fail");
const skipped = results.filter((r) => r.status === "skip");
console.log(`\n${failed.length ? "✗ verify:l06 FAILED" : "✓ verify:l06 green"} — ${results.filter((r) => r.status === "pass").length} passed, ${failed.length} failed, ${skipped.length} skipped`);
if (skipped.length) console.log(`  skipped: ${skipped.map((s) => s.name).join(", ")} (VERIFY_L06_STRICT=1 turns skips into failures)`);
process.exit(failed.length ? 1 : 0);
