"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ciRunKeys } from "@/shared/api/query-keys";
import { parseCiRuns } from "../model/parse";
import type { CiRunRow } from "../model/types";

/** The 50 most recent workspace CI runs, newest first (AC-19). */
export function useCiRuns() {
  return useQuery<CiRunRow[]>({
    queryKey: ciRunKeys.list,
    queryFn: async () => parseCiRuns(await api.get(`/ci-runs`)),
  });
}
