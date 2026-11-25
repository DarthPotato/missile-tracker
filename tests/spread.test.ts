import { describe, expect, it } from "vitest";
import { recentSpread, spreadPoints, type SpreadPoint } from "../src/lib/spread";
import { getDataset } from "../src/lib/data";
import { headline } from "../src/lib/model";
import type { Report } from "../src/lib/schema";

const report = (id: string, published: string, claims: Report["claims"], outlet = "Outlet"): Report => ({
  id,
  source: { outlet, title: id, url: `https://example.com/${id}`, published, kind: "news" },
  summary: "A test report with enough words.",
  claims,
  addedBy: "human",
  quoteCheck: "auto",
});
const claim = (metric: "prewar" | "pct_expended" | "remaining", low: number, high: number, asOf: string) => ({
  munition: "thaad" as const,
  metric,
  low,
  high,
  qualifier: "about" as const,
  asOf,
  confidence: "estimate" as const,
  quote: "a quote long enough",
});

describe("spreadPoints", () => {
  it("converts a share used into stock left with the nearest earlier prewar figure", () => {
    const reports = [
      report("a", "2026-03-01", [claim("prewar", 500, 500, "2026-02-27")]),
      report("b", "2026-06-01", [claim("pct_expended", 40, 60, "2026-05-30")]),
    ];
    const pts = spreadPoints(reports, "thaad");
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ kind: "converted", remaining: { low: 200, high: 300 }, headline: false });
    expect(pts[0].baseline).toEqual({ value: 500, outlet: "Outlet", published: "2026-03-01" });
  });

  it("skips a share with no baseline", () => {
    expect(spreadPoints([report("b", "2026-06-01", [claim("pct_expended", 50, 50, "2026-05-30")])], "thaad")).toEqual(
      [],
    );
  });

  it("marks exactly one headline point on real data", () => {
    const ds = getDataset();
    for (const m of ds.munitions) {
      const pts = spreadPoints(ds.reports, m.id, headline(ds.reports, m.id));
      expect(
        pts.filter((p) => p.headline),
        m.id,
      ).toHaveLength(1);
    }
  });
});

describe("recentSpread", () => {
  const pt = (asOf: string, low: number, high: number, over: Partial<SpreadPoint> = {}): SpreadPoint => ({
    asOf,
    remaining: { low, high },
    qualifier: "about",
    kind: "direct",
    confidence: "estimate",
    outlet: asOf,
    url: "u",
    published: asOf,
    headline: false,
    ...over,
  });
  it("covers points within the window of the newest and ignores one-sided bounds", () => {
    const s = recentSpread([
      pt("2026-01-01", 10, 20),
      pt("2026-07-01", 100, 150),
      pt("2026-07-20", 120, 200),
      pt("2026-07-25", 0, 50, { qualifier: "at-most" }),
    ]);
    expect(s).toEqual({ low: 100, high: 200, n: 2, since: "2026-07-01" });
  });
});
