/* FileGroup — one role group in Smart order: collapsible header with the role
   label, hint, "● N" (files with findings) and the file count. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { chevronFor, fs } from "../styles";

export function FileGroup({
  role,
  label,
  hint,
  color,
  fileCount,
  findingCount,
  defaultOpen,
  children,
}: {
  role: string;
  label: string;
  hint: string;
  color: string;
  fileCount: number;
  findingCount: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section data-role={role}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={fs.groupHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <span aria-hidden style={fs.swatch(color)} />
        <span style={fs.groupLabel}>{label}</span>
        <span style={fs.groupHint}>{hint}</span>
        {findingCount > 0 && (
          <span style={fs.findingCounter} data-testid={`group-findings-${role}`}>
            <span aria-hidden style={fs.dot} />
            {findingCount}
          </span>
        )}
        <span style={fs.groupCount}>{t("smartDiff.filesCount", { count: fileCount })}</span>
      </button>
      {open && <div style={fs.groupBody}>{children}</div>}
    </section>
  );
}
