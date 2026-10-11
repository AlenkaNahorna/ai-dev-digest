"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import { s } from "./styles";

export interface ReviewFocusProps {
  items: readonly ReviewFocusItem[];
  /** Open Files changed scrolled to this file. */
  onSelect: (file: string) => void;
}

/** Where to start reading, in the stored order: `file:line` (or `file`) and the reason. Each item is a button. */
export function ReviewFocus({ items, onSelect }: ReviewFocusProps) {
  const t = useTranslations("brief");
  return (
    <section style={s.wrap} aria-label={t("reviewFocus")}>
      <span style={s.sectionTitle}>{t("reviewFocus")}</span>
      {items.length === 0 ? (
        <div style={s.muted}>{t("noFocus")}</div>
      ) : (
        <ul style={s.list}>
          {items.map((item, i) => {
            const target = item.line != null ? `${item.file}:${item.line}` : item.file;
            return (
              <li key={`${item.file}-${i}`}>
                <button type="button" style={s.focusButton} aria-label={t("openFile", { file: target })} onClick={() => onSelect(item.file)}>
                  <span style={s.mono}>{target}</span>
                  <span style={s.focusReason}>{item.reason}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
