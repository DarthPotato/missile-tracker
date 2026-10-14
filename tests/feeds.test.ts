import { describe, expect, it } from "vitest";
import { looksRelevant, parseRss } from "../scripts/pipeline/feeds";
import { canonical } from "../scripts/pipeline/urls";

describe("looksRelevant", () => {
  it("needs a tracked missile and stockpile language", () => {
    expect(looksRelevant("THAAD interceptor stockpile runs low")).toBe(true);
    expect(looksRelevant("Raytheon wins SM-6 contract to replenish inventories")).toBe(true);
    expect(looksRelevant("Patriot fans celebrate playoff win")).toBe(false);
    expect(looksRelevant("Munitions shortfall worries Congress")).toBe(false);
  });
});

const rss = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`;
const item = (n: number) =>
  `<item><title>Story ${n}</title><link>https://example.com/${n}</link><pubDate>Tue, 13 Oct 2026 21:00:04 GMT</pubDate><description>About &amp; more</description></item>`;

describe("parseRss", () => {
  it("parses a channel with a single item", () => {
    expect(parseRss(rss(item(1)))).toEqual([
      {
        title: "Story 1",
        link: "https://example.com/1",
        pubDate: "Tue, 13 Oct 2026 21:00:04 GMT",
        description: "About & more",
      },
    ]);
  });

  it("parses many items", () => {
    expect(parseRss(rss(item(1) + item(2) + item(3))).map((i) => i.link)).toEqual([
      "https://example.com/1",
      "https://example.com/2",
      "https://example.com/3",
    ]);
  });

  it("returns nothing for an empty channel", () => {
    expect(parseRss(rss(""))).toEqual([]);
  });
});

describe("canonical", () => {
  it("strips tracking parameters and the hash, keeps real ones", () => {
    expect(canonical("https://ex.com/a?utm_source=x&utm_medium=y&id=7&fbclid=1&gclid=2&cmpid=3#top")).toBe(
      "https://ex.com/a?id=7",
    );
  });
});
