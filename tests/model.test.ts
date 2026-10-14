import { describe, expect, it } from "vitest";
import { getDataset } from "../src/lib/data";
import { defaultRebuildPerYear, headline, phase1BurnPerDay, project, stockPoints, claimsFor } from "../src/lib/model";
import { formatPct, formatRange } from "../src/lib/format";
import type { MunitionId } from "../src/lib/schema";

const ds = getDataset();
const hl = (id: MunitionId) => headline(ds.reports, id)!;

describe("dataset", () => {
  it("loads every munition with a headline", () => {
    for (const m of ds.munitions) expect(hl(m.id), m.id).toBeDefined();
  });
});

describe("headline", () => {
  it("uses CSIS's July range for Patriot, against the April prewar baseline", () => {
    const h = hl("patriot");
    expect(h.asOf).toBe("2026-07-27");
    expect(h.remaining).toEqual({ low: 759, high: 827 });
    expect(h.prewar).toBe(2330);
    expect(formatPct(h.pctLeft, h.qualifier)).toBe("33–35%");
  });

  it("prefers the 234-278 range over 'about 250' on the same date, with the revised 452 baseline", () => {
    const h = hl("thaad");
    expect(h.remaining).toEqual({ low: 234, high: 278 });
    expect(h.prewar).toBe(452);
  });

  it("surfaces CNN's later percentage as newer reporting instead of mixing baselines", () => {
    const h = hl("thaad");
    expect(h.newer.map((r) => r.claim.metric)).toContain("pct_expended");
  });

  it("derives prewar-minus-expended and flips 'more than 1,000 used' into 'at most 2,100 left'", () => {
    const h = hl("tomahawk");
    expect(h.method).toBe("prewar-minus-expended");
    expect(h.qualifier).toBe("at-most");
    expect(formatRange(h.remaining, h.qualifier)).toBe("≤2,100");
  });

  it("turns an expended range into a remaining range", () => {
    const h = hl("sm3");
    expect(h.remaining).toEqual({ low: 160, high: 280 });
    expect(h.qualifier).toBe("range");
  });

  it("never pairs an expended figure with another document's prewar number", () => {
    for (const m of ds.munitions) {
      for (const p of stockPoints(claimsFor(ds.reports, m.id))) {
        if (p.method === "prewar-minus-expended") expect(p.basis[0].report).toBe(p.basis[1].report);
      }
    }
  });
});

describe("phase 1 burn rate", () => {
  it("averages the ceasefire tally over 39 days", () => {
    expect(phase1BurnPerDay(ds.reports, "patriot")).toBeCloseTo((1060 + 1430) / 2 / 39, 5);
    expect(phase1BurnPerDay(ds.reports, "tomahawk")).toBeCloseTo(1000 / 39, 5);
  });
});

describe("project", () => {
  const base = { start: { date: "2026-01-01", low: 100, high: 200 }, prewar: 300, deliveriesPerYear: 365.25, end: "2027-12-31" };

  it("adds deliveries linearly and finds the recovery day for each track", () => {
    const r = project(base);
    expect(r.recovered.high).toBe("2026-04-11"); // 100 days at 1/day
    expect(r.recovered.low).toBe("2026-07-20"); // 200 days
    expect(r.points[0]).toEqual({ date: "2026-01-01", low: 100, high: 200 });
    expect(r.points.every((p) => p.date === "2026-01-01" || p.date.endsWith("-01") || p.date === "2027-12-31")).toBe(true);
  });

  it("delivers a rebuild lot once, at its own rate", () => {
    const r = project({ ...base, deliveriesPerYear: 0, rebuild: { quantity: 50, begin: "2026-02", perYear: 365.25 * 10 }, end: "2026-03-01" });
    expect(r.points.at(-1)!.low).toBeCloseTo(150, 6);
  });

  it("floors stock at zero during a scenario war and counts the shortfall", () => {
    const r = project({ ...base, deliveriesPerYear: 0, war: { start: "2026-02-01", days: 10, perDay: 15 }, end: "2026-03-01" });
    expect(r.depleted.low).toBe("2026-02-07"); // 100 / 15 -> empty on day 7
    expect(r.depleted.high).toBeUndefined(); // 200 - 150 = 50 left
    expect(r.shortfall).toBe(50);
    expect(r.points.at(-1)!.high).toBeCloseTo(50, 6);
  });

  it("does not count a pre-war recovery when a scenario war follows", () => {
    const r = project({ ...base, start: { date: "2026-01-01", low: 300, high: 300 }, deliveriesPerYear: 0, war: { start: "2026-02-01", days: 5, perDay: 10 } });
    expect(r.recovered.low).toBeUndefined();
  });
});

describe("calibration against CSIS's stated rebuild timelines", () => {
  // Our model is deliberately simple; these checks keep it in the same
  // neighbourhood as the analysts' own dates, using only sourced parameters.
  function recovery(id: MunitionId) {
    const m = ds.munitionById.get(id)!;
    const h = hl(id);
    const perYear = defaultRebuildPerYear(m);
    return project({
      start: { date: h.asOf, ...h.remaining },
      prewar: h.prewar,
      deliveriesPerYear: m.deliveriesPerYear.value,
      rebuild: perYear ? { quantity: m.fy27Request!.value, begin: m.fy27DeliveriesBegin!.value, perYear } : undefined,
      end: "2033-12-31",
    }).recovered;
  }

  it("Tomahawk recovers in late 2030 / early 2031 (CSIS: late 2030)", () => {
    expect(recovery("tomahawk").low! >= "2030-09" && recovery("tomahawk").low! <= "2031-03").toBe(true);
  });
  it("THAAD recovers in the second half of 2029 (CSIS: end of 2029)", () => {
    const r = recovery("thaad");
    expect(r.low! >= "2029-07" && r.low! <= "2030-03").toBe(true);
  });
  it("Patriot needs 3+ years from May 2026 (CSIS)", () => {
    expect(recovery("patriot").low! >= "2029-05").toBe(true);
  });
});
