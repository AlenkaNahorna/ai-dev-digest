import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown";

const render = (md: string, safe = true) => renderToStaticMarkup(<Markdown safe={safe}>{md}</Markdown>);

describe("Markdown safe mode (untrusted repo documents, AC-48)", () => {
  it("renders no raw HTML: script and inline handlers never reach the DOM", () => {
    const html = render("# T\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\ntext");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);
    expect(html).toContain("text");
  });

  it("never emits an <img>: markdown images become their alt text, remote URL unused", () => {
    const html = render("![diagram](https://evil.example/pixel.png)");
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain("evil.example");
    expect(html).toContain("[image: diagram]");
  });

  it("drops javascript:/data: link targets but keeps the link text", () => {
    const html = render("[click](javascript:alert(1)) and [d](data:text/html;base64,AAA)");
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/data:text/i);
    expect(html).toContain("click");
  });

  it("keeps http(s) links, opened with noopener", () => {
    const html = render("[docs](https://example.com/a)");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toMatch(/rel="noopener noreferrer nofollow"/);
  });

  it("leaves the default (trusted) mode behaviour for images unchanged", () => {
    expect(render("![a](https://x.example/p.png)", false)).toMatch(/<img/i);
  });
});
