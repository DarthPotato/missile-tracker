import { describe, expect, it } from "vitest";
import { getDataset, getPerspective } from "../src/lib/data";
import { formatDuration, resolveAmounts, trackedMissilesFired } from "../src/lib/perspective";

describe("trackedMissilesFired", () => {
  it("prices each missile's newest 'used' estimate at its current unit cost", () => {
    const ds = getDataset();
    const { value, asOf } = trackedMissilesFired(ds);
    const cost = Object.fromEntries(ds.munitions.map((m) => [m.id, m.unitCostM.value * 1e6]));
    // November CSIS Table 2, as of Nov 3: range midpoints, and the floor for "1,100+".
    const expected =
      ((1596 + 1697) / 2) * cost.patriot +
      ((239 + 254) / 2) * cost.thaad +
      ((130 + 250) / 2) * cost.sm3 +
      ((190 + 370) / 2) * cost.sm6 +
      1100 * cost.tomahawk +
      1100 * cost.jassm +
      ((70 + 90) / 2) * cost.prsm;
    expect(value).toBeCloseTo(expected, 0);
    expect(asOf).toBe("2026-11-03");
  });

  it("is the computed amount on the perspective page", () => {
    const ds = getDataset();
    const a = resolveAmounts(getPerspective(), ds).find((x) => x.id === "tracked-missiles")!;
    expect(a.value).toBe(trackedMissilesFired(ds).value);
  });
});

describe("formatDuration", () => {
  it("picks the largest unit that reads naturally", () => {
    expect(formatDuration(47.1e9, 18.9e9)).toBe("2.5 years");
    expect(formatDuration(47.1e9, 101.7e9)).toBe("5.6 months");
    expect(formatDuration(1e9, 101.7e9)).toBe("3.6 days");
    expect(formatDuration(5e6, 18.9e9)).toBe("2.3 hours");
    expect(formatDuration(5e6, 101.7e9)).toBe("26 minutes");
  });

  it("rounds big counts to whole numbers and keeps the singular", () => {
    expect(formatDuration(12e9, 1e9)).toBe("12 years");
    expect(formatDuration(1e9, 1e9)).toBe("1 year");
  });
});
