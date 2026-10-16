import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room.
    testTimeout: 240_000,
    hookTimeout: 240_000,
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    // LLM-backed cases are stochastic. CI sets EVAL_RETRY so one unlucky sample does not fail the job;
    // local eval:repeat / eval:delta measurement runs leave it at 0 so the pass-rate is not inflated.
    retry: Number(process.env.EVAL_RETRY ?? "0"),
    reporters: ["default", new TrendReporter()],
  },
});
