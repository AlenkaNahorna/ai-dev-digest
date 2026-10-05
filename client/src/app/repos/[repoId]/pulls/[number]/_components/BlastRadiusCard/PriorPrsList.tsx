"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PriorPr } from "@devdigest/shared";
import { githubPrUrl } from "@/lib/github-urls";
import { s } from "./styles";

export interface PriorPrsListProps {
  priorPrs: PriorPr[];
  repoFullName: string | null;
}

/** Earlier PRs that touched the same files (context for "has this area broken before?"). */
export function PriorPrsList({ priorPrs, repoFullName }: PriorPrsListProps) {
  const t = useTranslations("blast");
  if (priorPrs.length === 0) return null;
  return (
    <div style={s.priorWrap}>
      <span style={s.sectionTitle}>{t("priorPrs.title")}</span>
      <ul style={s.list}>
        {priorPrs.map((pr) => (
          <li key={pr.number} style={s.priorRow}>
            {repoFullName ? (
              <a href={githubPrUrl(repoFullName, pr.number)} target="_blank" rel="noopener noreferrer" style={s.priorLink}>
                #{pr.number}
              </a>
            ) : (
              <span style={s.symbol}>#{pr.number}</span>
            )}
            <span style={s.priorTitle}>{pr.title}</span>
            <span style={s.symbolFile}>{pr.status}</span>
            <span style={s.count}>{t("priorPrs.shared", { count: pr.shared_files })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
