import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Link targets a safe preview may render as clickable: web links, mail, in-page anchors. */
function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  return /^(https?:|mailto:|#)/i.test(href.trim()) ? href.trim() : null;
}

/**
 * Markdown renderer (replaces prototype mdLite). Inline + GFM.
 *
 * `safe` is the opt-in mode for UNTRUSTED repository documents (Project Context
 * preview): raw HTML is dropped (never rendered), images are shown as their alt
 * text only (no remote fetch), and links keep only http(s)/mailto/#anchor
 * targets (no `javascript:`/`data:`), opening in a new tab with noopener.
 */
export function Markdown({ children, safe = false }: { children?: string | null; safe?: boolean }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        {...(safe ? { skipHtml: true, urlTransform: (url: string) => safeHref(url) ?? "" } : {})}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          a: ({ children, href }) => {
            if (!safe) {
              return (
                <a href={href} style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
                  {children}
                </a>
              );
            }
            const target = safeHref(href);
            if (!target) return <span>{children}</span>;
            return (
              <a
                href={target}
                {...(target.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer nofollow" })}
                style={{ color: "var(--accent-text)", textDecoration: "underline" }}
              >
                {children}
              </a>
            );
          },
          ...(safe
            ? {
                // Never load remote (or any) image content from an untrusted document.
                img: ({ alt }: { alt?: string }) => (
                  <span className="mono" data-blocked-image style={{ color: "var(--text-muted)" }}>
                    [image{alt ? `: ${alt}` : ""}]
                  </span>
                ),
              }
            : {}),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
