/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline.
   Optional Smart Diff: role `groups` (reviewer order) + inline `findingApi`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import type { DiffFindingApi, DiffGroupView } from "../findings";
import { GROUP_COLOR } from "../constants";
import { s, fs } from "../styles";
import { FileCard } from "../FileCard";
import { FileGroup } from "../FileGroup";

export function DiffViewer({
  files,
  commenting,
  groups,
  ungrouped,
  findingApi,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** When set, files render in these role groups (Smart order) instead of flat. */
  groups?: DiffGroupView[];
  /** Files missing from the smart-diff response; rendered last, flat. */
  ungrouped?: PrFile[];
  findingApi?: DiffFindingApi;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  if (groups) {
    return (
      <div style={fs.groups}>
        {groups.map((g) => (
          <FileGroup
            key={g.role}
            role={g.role}
            label={g.label}
            hint={g.hint}
            color={GROUP_COLOR[g.role] ?? "var(--text-muted)"}
            fileCount={g.files.length}
            findingCount={g.findingCount}
            defaultOpen={g.defaultOpen}
          >
            {g.files.map((f) => (
              <FileCard
                key={f.path}
                file={f}
                commenting={commenting}
                findingApi={findingApi}
                hasFindings={g.findingPaths.has(f.path) || undefined}
              />
            ))}
          </FileGroup>
        ))}
        {ungrouped && ungrouped.length > 0 && (
          <div style={s.list}>
            {ungrouped.map((f) => (
              <FileCard key={f.path} file={f} commenting={commenting} findingApi={findingApi} />
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={s.list}>
      {files.map((f) => (
        <FileCard key={f.path} file={f} commenting={commenting} findingApi={findingApi} />
      ))}
    </div>
  );
}
