import { CiRunsScreen } from "@/features/ci-runs/ui/CiRunsScreen";

/* Route: /ci-runs — workspace CI Runs list. Thin RSC entry; the hook-owning
   screen and its read-only presentational view live under features/ci-runs. */
export default function CiRunsPage() {
  return <CiRunsScreen />;
}
