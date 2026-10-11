"use client";
import React from "react";
import type {
  OnboardingTourContent,
  TourProvenance,
} from "@devdigest/shared/contracts/onboarding-generator";
import { Badge, Button, Card, Icon, Markdown } from "@devdigest/ui";
import { SECTION_TITLES, sectionAnchor, sourceUrl, type SectionKey } from "../model/view";
import { ArchitectureDiagram } from "./ArchitectureDiagram";

type Section = OnboardingTourContent["sections"][number];

/** Copy to clipboard with visible feedback; failure is reported, never swallowed silently. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };
  return (
    <Button
      kind="ghost"
      size="sm"
      icon={state === "copied" ? "Check" : state === "failed" ? "AlertTriangle" : "Copy"}
      onClick={onClick}
      aria-live="polite"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </Button>
  );
}

/** "Open" for a file at the stored commit; inert text when no safe link can be built. */
function OpenLink({ repoFullName, sha, path }: { repoFullName: string | null; sha: string; path: string }) {
  const href = sourceUrl(repoFullName, sha, path);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ fontSize: 12.5, color: "var(--accent-text)", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
      aria-label={`Open ${path} at commit ${sha.slice(0, 7)}`}
    >
      Open <Icon.ExternalLink size={12} />
    </a>
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => (
  <span className="mono" style={{ fontSize: 12.5, color: "var(--text-primary)", wordBreak: "break-all" }}>
    {children}
  </span>
);

function Unavailable({ reason }: { reason: string }) {
  return (
    <div role="note" style={{ display: "flex", gap: 10, color: "var(--text-secondary)", fontSize: 13.5 }}>
      <Icon.Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        <strong style={{ color: "var(--text-primary)" }}>Not available.</strong> {reason}
      </div>
    </div>
  );
}

function SectionBody({ section, repoFullName, sha }: { section: Section; repoFullName: string | null; sha: string }) {
  if (section.status === "unavailable") return <Unavailable reason={section.reason} />;
  switch (section.key) {
    case "architecture":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            {/* safe: raw HTML dropped, images → alt text, only http(s)/mailto/# links */}
            <Markdown safe>{section.summary}</Markdown>
          </div>
          {section.diagram ? (
            <ArchitectureDiagram diagram={section.diagram} />
          ) : (
            <div role="note" style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {section.diagram_note ?? "No diagram: the index does not contain enough relationship evidence."}
            </div>
          )}
          {section.diagram && section.diagram_note && (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{section.diagram_note}</div>
          )}
        </div>
      );
    case "critical_paths":
      return (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
          {section.entries.map((e) => (
            <li
              key={e.path}
              style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "10px 0", borderTop: "1px solid var(--border)" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <Mono>{e.path}</Mono>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>{e.role}</div>
              </div>
              <OpenLink repoFullName={repoFullName} sha={sha} path={e.path} />
            </li>
          ))}
        </ul>
      );
    case "local_run":
      return (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {[...section.steps]
            .sort((a, b) => a.order - b.order)
            .map((s, i) => (
              <li key={`${s.order}-${i}`} style={{ display: "flex", gap: 12 }}>
                <span
                  aria-hidden
                  style={{ width: 22, height: 22, borderRadius: 11, background: "var(--bg-hover)", display: "grid", placeItems: "center", fontSize: 12, flexShrink: 0 }}
                >
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5 }}>{s.instruction}</div>
                  {s.command && (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, padding: "6px 10px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 }}
                    >
                      <code className="mono" style={{ flex: 1, fontSize: 12.5, overflowX: "auto", whiteSpace: "pre" }}>
                        {s.command}
                      </code>
                      <CopyButton text={s.command} />
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
                    Source: <span className="mono">{s.source}</span>
                  </div>
                </div>
              </li>
            ))}
        </ol>
      );
    case "reading_path":
      return (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
          {[...section.entries]
            .sort((a, b) => a.order - b.order)
            .map((e, i) => (
              <li
                key={`${e.order}-${e.path}`}
                style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderTop: "1px solid var(--border)" }}
              >
                <span aria-hidden style={{ width: 22, height: 22, borderRadius: 11, background: "var(--bg-hover)", display: "grid", placeItems: "center", fontSize: 12, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Mono>{e.path}</Mono>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>{e.reason}</div>
                </div>
                <OpenLink repoFullName={repoFullName} sha={sha} path={e.path} />
              </li>
            ))}
        </ol>
      );
    case "first_tasks":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            Suggestions based on the indexed code — they are not existing issues or confirmed defects.
          </div>
          {section.tasks.map((t, i) => (
            <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{t.description}</div>
              {t.files.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {t.files.map((f) => (
                    <Badge key={f} mono>
                      {f}
                    </Badge>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 12.5, marginTop: 8 }}>
                <strong>Done when:</strong> <span style={{ color: "var(--text-secondary)" }}>{t.outcome}</span>
              </div>
            </div>
          ))}
        </div>
      );
  }
}

/** The five collapsible cards, each addressable by an anchor for "ON THIS PAGE". */
export function TourSections({
  content,
  provenance,
  repoFullName,
}: {
  content: OnboardingTourContent;
  provenance: TourProvenance;
  repoFullName: string | null;
}) {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {content.sections.map((section) => {
        const key = section.key as SectionKey;
        const isCollapsed = collapsed[key] === true;
        const bodyId = `${sectionAnchor(key)}-body`;
        return (
          <section key={key} id={sectionAnchor(key)} aria-labelledby={`${sectionAnchor(key)}-title`} style={{ scrollMarginTop: 72 }}>
            <Card pad={false}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
                aria-controls={bodyId}
                style={{ all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", cursor: "pointer" }}
              >
                {isCollapsed ? <Icon.ChevronRight size={16} /> : <Icon.ChevronDown size={16} />}
                <h2 id={`${sectionAnchor(key)}-title`} style={{ fontSize: 15, fontWeight: 650, margin: 0, flex: 1 }}>
                  {SECTION_TITLES[key]}
                </h2>
                {section.status === "unavailable" && <Badge>Not available</Badge>}
              </button>
              {!isCollapsed && (
                <div id={bodyId} style={{ padding: "0 18px 18px" }}>
                  <SectionBody section={section} repoFullName={repoFullName} sha={provenance.source_sha} />
                </div>
              )}
            </Card>
          </section>
        );
      })}
    </div>
  );
}

/** Right-rail "ON THIS PAGE" anchors. */
export function OnThisPage({ keys }: { keys: SectionKey[] }) {
  return (
    <nav aria-label="On this page" style={{ position: "sticky", top: 16, fontSize: 13 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, color: "var(--text-muted)", marginBottom: 8 }}>ON THIS PAGE</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {keys.map((k) => (
          <li key={k}>
            <a
              href={`#${sectionAnchor(k)}`}
              onClick={(e) => {
                const el = document.getElementById(sectionAnchor(k));
                if (el) {
                  e.preventDefault();
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                  history.replaceState(null, "", `#${sectionAnchor(k)}`);
                }
              }}
              style={{ color: "var(--text-secondary)" }}
            >
              {SECTION_TITLES[k]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
