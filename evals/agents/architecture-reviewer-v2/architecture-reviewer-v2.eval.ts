import { describeAgent, runAgentCases } from "../../src/index.js";
// Variant of the primary architecture-reviewer (onion-architecture v1). Same cases, same fixtures,
// same practices and threshold; the only difference is the skill it loads (onion-architecture-v2),
// so `pnpm eval:repeat` + `pnpm eval:delta` on the two labels measures the v2 change.
import { cases } from "../architecture-reviewer/architecture-reviewer.cases.js";

describeAgent("architecture-reviewer-v2", () => runAgentCases("architecture-reviewer-v2", cases));
