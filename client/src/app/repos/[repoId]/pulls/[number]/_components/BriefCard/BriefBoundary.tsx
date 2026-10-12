"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState } from "@devdigest/ui";
import { ErrorBoundary } from "@/lib/error-boundary";

export interface BriefBoundaryProps {
  /** Reset (and retry) when this changes, e.g. a freshly loaded brief. */
  resetKey?: unknown;
  onRetry: () => void;
  children: React.ReactNode;
}

/** Contains a render error in a brief piece (it parses model-written data) so the PR page keeps working. */
export function BriefBoundary({ resetKey, onRetry, children }: BriefBoundaryProps) {
  const t = useTranslations("brief");
  return (
    <ErrorBoundary
      resetKeys={[resetKey]}
      fallback={(reset) => (
        <ErrorState
          title={t("loadError.title")}
          body={t("loadError.body")}
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
