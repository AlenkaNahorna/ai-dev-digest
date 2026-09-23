import { describe, it, expect } from "vitest";
import { formatCost } from "./format-cost";

describe("formatCost", () => {
  it("renders '—' for null/undefined — never a fabricated $0.00", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
  });

  it("renders exact $0.00 only when the cost really is zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("uses 2 significant figures below $1, trimmed of insignificant trailing zeros", () => {
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.014)).toBe("$0.014");
    expect(formatCost(0.06)).toBe("$0.06");
  });

  it("uses standard 2-decimal currency at/above $1", () => {
    expect(formatCost(1.2)).toBe("$1.20");
    expect(formatCost(12.345)).toBe("$12.35");
  });

  it("puts the minus sign before the dollar sign for negative costs", () => {
    expect(formatCost(-0.05)).toBe("-$0.05");
    expect(formatCost(-1.5)).toBe("-$1.50");
  });

  it("renders '—' for non-finite input instead of \"$NaN\"/\"$Infinity\"", () => {
    expect(formatCost(NaN)).toBe("—");
    expect(formatCost(Infinity)).toBe("—");
    expect(formatCost(-Infinity)).toBe("—");
  });
});
