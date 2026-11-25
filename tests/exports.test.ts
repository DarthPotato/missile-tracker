import { describe, expect, it } from "vitest";
import { getDataset } from "../src/lib/data";
import { CLAIM_COLUMNS, claimRows, headlineRows, rss, toCsv } from "../src/lib/exports";

const ds = getDataset();

describe("downloads", () => {
  it("has one CSV row per claim, quoting cells that need it", () => {
    const rows = claimRows(ds);
    expect(rows).toHaveLength(ds.reports.reduce((n, r) => n + r.claims.length, 0));
    const csv = toCsv(CLAIM_COLUMNS, [{ ...rows[0], quote: 'He said "two-thirds", then\nmore' }]);
    expect(csv.split("\r\n")[0]).toBe(CLAIM_COLUMNS.join(","));
    expect(csv).toContain('"He said ""two-thirds"", then\nmore"');
  });
  it("gives a headline per missile", () => {
    expect(
      headlineRows(ds)
        .map((r) => r.munition)
        .sort(),
    ).toEqual(ds.munitions.map((m) => m.id).sort());
  });
});

describe("rss", () => {
  it("is well formed and escapes text", () => {
    const xml = rss(ds, "https://missiletracker.info", (p) => p, "T & T", "D");
    expect(xml).toContain("<title>T &amp; T</title>");
    expect(xml.match(/<item>/g)!.length).toBe(Math.min(50, ds.reports.length));
    expect(xml).toContain('href="https://missiletracker.info/feed.xml"');
  });
});
