import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Sparkline } from "@devdigest/ui";

afterEach(cleanup);

describe("Sparkline with the first eval run (one point)", () => {
  it("draws a finite dot instead of NaN coordinates", () => {
    const { container } = render(<Sparkline data={[1]} w={120} h={22} />);
    const circle = container.querySelector("circle")!;
    expect(Number.isFinite(Number(circle.getAttribute("cx")))).toBe(true);
    expect(Number.isFinite(Number(circle.getAttribute("cy")))).toBe(true);
    expect(container.querySelector("path")!.getAttribute("d")).not.toMatch(/NaN/);
  });
  it("still spreads several points over the width and renders nothing for none", () => {
    const { container } = render(<Sparkline data={[0.2, 0.6, 0.4]} w={100} h={20} />);
    expect(container.querySelector("path")!.getAttribute("d")).toMatch(/^M0\.0,.* L100\.0,/);
    cleanup();
    expect(render(<Sparkline data={[]} />).container.querySelector("svg")).toBeNull();
  });
});
