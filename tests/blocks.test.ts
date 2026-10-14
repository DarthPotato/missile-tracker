import { describe, expect, it } from "vitest";
import { blockCounts, formatDollars } from "../src/lib/blocks";

describe("blockCounts", () => {
  it("splits a range into left, uncertain and used blocks of 10", () => {
    const b = blockCounts({ prewar: 2330, remaining: { low: 759, high: 827 }, qualifier: "range" }, 10);
    expect(b).toEqual({ total: 233, left: 75, uncertain: 8, used: 150 });
  });

  it("treats an 'at most' figure as all uncertain", () => {
    const b = blockCounts({ prewar: 3100, remaining: { low: 2100, high: 2100 }, qualifier: "at-most" }, 10);
    expect(b).toEqual({ total: 310, left: 0, uncertain: 210, used: 100 });
  });

  it("scales by unit cost for dollar blocks", () => {
    // 410 SM-3s at $28.7M = $11.77B -> 235 blocks of $50M
    const b = blockCounts({ prewar: 410, remaining: { low: 160, high: 280 }, qualifier: "range" }, 50e6, 28.7e6);
    expect(b.total).toBe(235);
    expect(b.left + b.uncertain + b.used).toBe(235);
  });

  it("always shows at least one block and never more left than total", () => {
    const b = blockCounts({ prewar: 4, remaining: { low: 9, high: 9 }, qualifier: "about" }, 10);
    expect(b.total).toBe(1);
    expect(b.left).toBeLessThanOrEqual(1);
  });
});

describe("formatDollars", () => {
  it("compacts", () => {
    expect(formatDollars(50e6)).toBe("$50M");
    expect(formatDollars(33.4e9)).toBe("$33.4B");
  });
});
