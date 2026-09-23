import { PullsScreen } from "@/features/pulls/ui/PullsScreen";

export default async function PullsPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  return <PullsScreen repoId={repoId} />;
}
