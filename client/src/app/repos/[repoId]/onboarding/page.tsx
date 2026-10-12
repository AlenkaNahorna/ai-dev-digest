import { OnboardingTourScreen } from "@/features/onboarding-generator/ui/OnboardingTourScreen";

/* Route: /repos/:repoId/onboarding (Onboarding Tour). Thin RSC entry — the interactive
   screen lives in features/onboarding-generator. */
export default async function OnboardingTourPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  return <OnboardingTourScreen repoId={repoId} />;
}
