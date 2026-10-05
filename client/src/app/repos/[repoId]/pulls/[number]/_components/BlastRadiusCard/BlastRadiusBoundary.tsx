"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState } from "@devdigest/ui";
import { ErrorBoundary } from "@/lib/error-boundary";

export interface BlastRadiusBoundaryProps {
  /** Reset (and retry) when this changes, e.g. the freshly loaded blast data. */
  resetKey?: unknown;
  onRetry: () => void;
  children: React.ReactNode;
}

/** Contains a render error in the Blast radius block so the rest of the PR page keeps working. */
export function BlastRadiusBoundary({ resetKey, onRetry, children }: BlastRadiusBoundaryProps) {
  const t = useTranslations("blast");
  return (
    <ErrorBoundary
      resetKeys={[resetKey]}
      fallback={(reset) => (
        <ErrorState
          title={t("error.title")}
          body={t("error.body")}
          onRetry={() => {
            reset();
            onRetry();
          }}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
