/* /multi-agent — the Multi-Agent Review entry. Thin RSC: resolves the query
   params and hands off to the client entry, which shows the results of a run
   (?pr=&run=), the Configure run screen (?configure=1[&pr=]) or, when neither is
   given, the newest run of the active repo (or Configure when there is none). */
import { MultiAgentEntry } from "@/features/multi-agent-review/ui/MultiAgentEntry";

export default async function MultiAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ pr?: string; run?: string; trace?: string; configure?: string }>;
}) {
  const { pr, run, configure } = await searchParams;
  return <MultiAgentEntry prId={pr ?? null} parentId={run ?? null} configure={configure === "1"} />;
}
