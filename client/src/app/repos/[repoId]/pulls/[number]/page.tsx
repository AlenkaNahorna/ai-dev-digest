import { PullDetailScreen } from "@/features/pull-detail/ui/PullDetailScreen";

export default async function PRDetailPage({ params }: { params: Promise<{ repoId: string; number: string }> }) {
  const { repoId, number } = await params;
  return <PullDetailScreen repoId={repoId} number={number} />;
}
