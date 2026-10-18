/* /multi-agent?pr=<prId>&run=<parentId> — multi-agent review results.
   Thin RSC entry: resolves the query params and hands off to the client screen
   that owns the data fetching, Columns/Tabs toggle, conflicts block and drawer. */
import { MultiAgentResultsScreen } from "@/features/multi-agent-review/ui/MultiAgentResultsScreen";

export default async function MultiAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ pr?: string; run?: string; trace?: string }>;
}) {
  const { pr, run } = await searchParams;
  return <MultiAgentResultsScreen prId={pr ?? null} parentId={run ?? null} />;
}
