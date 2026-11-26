import { describe, expect, it } from "vitest";
import { archiveItems, archiveNews, gdeltDate } from "../scripts/live/news-archive";

describe("news archive", () => {
  it("reads GDELT dates", () => {
    expect(gdeltDate("20260402T123000Z")).toBe("2026-04-02T12:30:00Z");
    expect(gdeltDate("April 2")).toBeUndefined();
  });
  it("keeps English headlines about intercepts that it hasn't seen", () => {
    const json = {
      articles: [
        {
          url: "https://www.gulfnews.com/a",
          title: "UAE air defence intercepted 19 ballistic missiles and 26 drones from Iran",
          seendate: "20260403T080000Z",
          domain: "www.gulfnews.com",
          language: "English",
        },
        { url: "https://example.com/b", title: "Oil prices rise", seendate: "20260403T080000Z", domain: "example.com" },
        {
          url: "https://example.com/seen",
          title: "Israel intercepted 30 missiles",
          seendate: "20260403T080000Z",
          domain: "example.com",
        },
        {
          url: "https://example.com/fr",
          title: "Les EAU ont intercepté 19 missiles",
          seendate: "20260403T080000Z",
          domain: "example.com",
          language: "French",
        },
      ],
    };
    const items = archiveItems(json, new Set(["https://example.com/seen"]));
    expect(items).toEqual([
      {
        kind: "news",
        name: "gulfnews.com",
        url: "https://www.gulfnews.com/a",
        posted: "2026-04-03T08:00:00Z",
        official: false,
        text: "UAE air defence intercepted 19 ballistic missiles and 26 drones from Iran",
      },
    ]);
  });
  it("copes with an empty or odd answer", () => {
    expect(archiveItems({}, new Set())).toEqual([]);
    expect(archiveItems(null, new Set())).toEqual([]);
  });
});

describe("archiveNews", () => {
  const article = {
    url: "https://example.com/a",
    title: "UAE intercepted 12 ballistic missiles",
    seendate: "20260403T080000Z",
    domain: "example.com",
  };
  it("tries a rate-limited search again, and gives up on one that keeps failing", async () => {
    const answers = [new Response("slow down", { status: 429 }), new Response(JSON.stringify({ articles: [article] }))];
    const waits: number[] = [];
    const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const ok = await archiveNews(["q"], since, new Set(), () => {}, {
      wait: async (ms) => void waits.push(ms),
      get: async () => answers.shift() ?? new Response("{}"),
    });
    expect(ok.items.map((i) => i.url)).toEqual(["https://example.com/a"]);
    expect(ok.failed).toBe(0);
    expect(waits[0]).toBe(20_000);

    const bad = await archiveNews(["q"], since, new Set(), () => {}, {
      wait: async () => {},
      get: async () => new Response("no", { status: 429 }),
    });
    expect(bad).toEqual({ items: [], failed: 1, skipped: 0 });
  });
});
