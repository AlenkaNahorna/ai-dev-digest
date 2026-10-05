"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { ChangedSymbol, DownstreamImpact } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { chipTone, s } from "./styles";

export interface BlastSymbolRowProps {
  symbol: ChangedSymbol;
  /** Downstream group for this symbol; undefined when nothing calls it. */
  impact: DownstreamImpact | undefined;
  /** Number of other files declaring a symbol with the same name (callers are shared). */
  extraFiles: number;
  defaultOpen: boolean;
  repoFullName: string | null;
  headSha: string;
}

/** One changed symbol: a collapsible list of its callers plus endpoint and cron chips. */
export function BlastSymbolRow({ symbol, impact, extraFiles, defaultOpen, repoFullName, headSha }: BlastSymbolRowProps) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(defaultOpen);
  const callers = impact?.callers ?? [];
  const endpoints = impact?.endpoints_affected ?? [];
  const crons = impact?.crons_affected ?? [];

  const head = (
    <>
      <span style={s.symbolIcon} aria-hidden="true"><Icon.Code size={14} /></span>
      <span style={s.symbol}>{symbol.name}</span>
      <span style={s.symbolFile}>{symbol.file}</span>
      {extraFiles > 0 && <span style={s.symbolFile}>{t("moreFiles", { count: extraFiles })}</span>}
      <span style={s.count}>{t("callerCount", { count: callers.length })}</span>
    </>
  );

  if (callers.length === 0) {
    return (
      <li style={s.row}>
        <div style={s.rowHead}>{head}</div>
      </li>
    );
  }

  return (
    <li style={s.row}>
      <div style={s.rowHead}>
        <button
          type="button"
          style={s.toggle}
          aria-expanded={open}
          aria-label={t(open ? "collapseSymbol" : "expandSymbol", { symbol: symbol.name })}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <Icon.ChevronDown size={14} /> : <Icon.ChevronRight size={14} />}
          {head}
        </button>
      </div>
      {open && (
        <div style={s.body}>
          <ul style={s.callers}>
            {callers.map((c) => (
              <li key={`${c.file}:${c.line}:${c.name}`} style={s.caller}>
                <Icon.CornerDownRight size={12} aria-hidden="true" />
                <span style={s.callerName}>{c.name}</span>
                {repoFullName ? (
                  <a
                    href={githubBlobUrl(repoFullName, headSha, c.file, c.line)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={s.link}
                  >
                    {c.file}:{c.line}
                  </a>
                ) : (
                  <span style={s.location}>{c.file}:{c.line}</span>
                )}
              </li>
            ))}
          </ul>
          {(endpoints.length > 0 || crons.length > 0) && (
            <div style={s.chips}>
              {endpoints.map((e) => <Badge key={`e:${e}`} mono icon="Globe" color={chipTone.endpoint.color} bg={chipTone.endpoint.bg}>{e}</Badge>)}
              {crons.map((c) => <Badge key={`c:${c}`} mono icon="Clock" color={chipTone.cron.color} bg={chipTone.cron.bg}>{c}</Badge>)}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
