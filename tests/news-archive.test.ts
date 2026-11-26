import { describe, expect, it } from "vitest";
import { archiveItems, gdeltDate } from "../scripts/live/news-archive";

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
