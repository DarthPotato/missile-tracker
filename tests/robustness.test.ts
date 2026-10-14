import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bingItem } from "../scripts/pipeline/feeds";
import { buildDataset, DataError } from "../src/lib/dataset";
import { headline } from "../src/lib/model";
import type { Report } from "../src/lib/schema";

const munitions = JSON.parse(readFileSync("data/munitions.json", "utf8"));
const reportFiles = () =>
  readdirSync("data/reports").map((file) => ({ file, json: JSON.parse(readFileSync(`data/reports/${file}`, "utf8")) }));

describe("headline", () => {
  it("returns undefined instead of an infinite % left when prewar is 0", () => {
    const report = {
      id: "x",
      source: { outlet: "X", title: "X", url: "https://x.example", published: "2026-05-01", kind: "news" },
      summary: "A made-up report for this test.",
      addedBy: "human",
      quoteCheck: "auto",
      claims: [
        { munition: "prsm", metric: "prewar", low: 0, high: 0, qualifier: "about", asOf: "2026-02-28", confidence: "estimate", quote: "zero prewar in this test" },
        { munition: "prsm", metric: "remaining", low: 5, high: 5, qualifier: "about", asOf: "2026-05-01", confidence: "estimate", quote: "five left in this test" },
      ],
    } as Report;
    expect(headline([report], "prsm")).toBeUndefined();
  });
});

describe("buildDataset", () => {
  it("names the missile that has no usable headline", () => {
    const files = reportFiles().map((f) =>
      f.file === "2026-04-21-csis-last-rounds.json"
        ? { ...f, json: { ...f.json, claims: f.json.claims.filter((c: { munition: string }) => c.munition !== "prsm") } }
        : f,
    );
    expect(() => buildDataset(munitions, files)).toThrow(DataError);
    expect(() => buildDataset(munitions, files)).toThrow(/prsm: no usable headline/);
  });

  it("accepts the real data", () => {
    expect(() => buildDataset(munitions, reportFiles())).not.toThrow();
  });
});

describe("bingItem", () => {
  it("unwraps Bing's click-tracking link", () => {
    const i = bingItem({
      title: "THAAD stocks",
      link: "http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=https%3a%2f%2fwww.example.com%2fstory&c=1",
      pubDate: "Tue, 13 Oct 2026 21:00:04 GMT",
    });
    expect(i).toMatchObject({ url: "https://www.example.com/story", outlet: "example.com", published: "2026-10-13" });
  });

  it("skips a malformed item instead of throwing", () => {
    expect(bingItem({ title: "bad", link: "not a url" })).toBeUndefined();
    expect(bingItem({ title: "bad", link: "http://www.bing.com/news/apiclick.aspx?url=also%20not%20a%20url" })).toBeUndefined();
  });
});
