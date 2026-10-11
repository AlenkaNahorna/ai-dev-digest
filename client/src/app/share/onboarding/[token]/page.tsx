import type { Metadata } from "next";
import { PublicTourScreen } from "@/features/onboarding-generator/ui/PublicTourScreen";

/* Route: /share/onboarding/:token — public, anonymous snapshot. The token is a bearer
   secret: keep the page out of search indexes and never leak it through Referer. */
export const metadata: Metadata = {
  title: "Shared onboarding tour · DevDigest",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function SharedOnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicTourScreen token={token} />;
}
