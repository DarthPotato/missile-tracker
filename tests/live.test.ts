import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchChannel, parseChannelPage, looksLikeIntercept, looksLikeTally } from "../scripts/live/telegram";
import { validate, type Item } from "../scripts/live/extract";
import {
  dailySeries,
  eventCount,
  mergeEvents,
  reliability,
  totals,
  type LiveEvent,
  type LiveSource,
} from "../src/lib/live";

const html = readFileSync(new URL("./fixtures/tme-channel.html", import.meta.url), "utf8");

describe("parseChannelPage", () => {
  const posts = parseChannelPage(html, "kpszsu");
  it("keeps text posts from this channel, oldest first", () => {
    expect(posts.map((p) => p.id)).toEqual([30119, 30120]);
  });
  it("reads the text, link and time", () => {
    const p = posts[1];
    expect(p.url).toBe("https://t.me/kpszsu/30120");
    expect(p.posted).toBe("2026-11-23T06:41:12+00:00");
    expect(p.text).toContain("збито/подавлено 71 ворожий БпЛА");
    expect(posts[0].text).toContain("& техніка");
  });
});

describe("looksLikeIntercept", () => {
  it("passes intercept posts in English and Ukrainian", () => {
    expect(looksLikeIntercept("Bahrain says it intercepted 4 drones")).toBe(true);
    expect(looksLikeIntercept("збито 71 БпЛА")).toBe(true);
    expect(looksLikeIntercept("Weather update for Kyiv")).toBe(false);
  });
});

describe("looksLikeTally", () => {
  it("wants a shot-down word and a number", () => {
    expect(looksLikeTally("збито/подавлено 71 ворожий БпЛА")).toBe(true);
    expect(looksLikeTally("Bahrain intercepted 4 drones")).toBe(true);
    expect(looksLikeTally("Група ударних БпЛА курсом на Конотоп")).toBe(false);
    expect(looksLikeTally("drones were shot down over the city")).toBe(false);
  });
});

describe("fetchChannel", () => {
  // Three pages of ten posts, one a day, newest page first, like t.me/s/<handle>?before=<id>.
  const post = (id: number) => {
    const day = String(id).padStart(2, "0");
    return `<div class="tgme_widget_message_wrap"><div data-post="kpszsu/${id}"><div class="tgme_widget_message_text">збито ${id}</div><time datetime="2026-11-${day}T07:00:00+00:00"></time></div></div>`;
  };
  const page = (ids: number[]) => ids.map(post).join("");
  const pages: Record<string, string> = {
    "": page([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]),
    "?before=21": page([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
    "?before=11": page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  };
  const calls: string[] = [];
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    calls.length = 0;
  });
  const stub = () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        const q = url.split("kpszsu")[1];
        return new Response(pages[q] ?? "", { status: 200 });
      }),
    );
  };
  const run = async (p: Promise<unknown>) => {
    await vi.runAllTimersAsync();
    return p;
  };

  it("stops at the last post it has already read", async () => {
    stub();
    const posts = (await run(fetchChannel("kpszsu", 25))) as { id: number }[];
    expect(posts.map((p) => p.id)).toEqual([26, 27, 28, 29, 30]);
    expect(calls).toHaveLength(1);
  });

  it("backfills back to a date, past the usual three pages' worth of reading", async () => {
    stub();
    const posts = (await run(fetchChannel("kpszsu", 0, { since: "2026-11-15" }))) as { id: number }[];
    expect(posts.map((p) => p.id)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    expect(calls).toHaveLength(2);
  });
});

const src = (over: Partial<LiveSource> = {}): LiveSource => ({
  kind: "telegram",
  name: "Ukrainian Air Force",
  url: "https://t.me/kpszsu/1",
  posted: "2026-11-23T06:41:12+00:00",
  official: true,
  launched: 87,
  intercepted: 71,
  quote: "збито/подавлено 71",
  ...over,
});
const ev = (over: Partial<LiveEvent> = {}): LiveEvent => ({
  id: "x",
  date: "2026-11-22",
  theater: "ukraine",
  defender: "Ukraine",
  threat: "drone",
  systems: [],
  usInvolved: false,
  sources: [src()],
  ...over,
});

describe("mergeEvents", () => {
  it("joins the same event from two channels and keeps both sources", () => {
    const b = ev({
      sources: [src({ name: "OSINTdefender", url: "https://t.me/OSINTdefender/9", official: false, intercepted: 80 })],
      systems: ["Patriot"],
    });
    const merged = mergeEvents([ev()], [b, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toHaveLength(2);
    expect(merged[0].systems).toEqual(["Patriot"]);
  });
  it("keeps different days or threats apart, newest first", () => {
    const merged = mergeEvents([ev()], [ev({ date: "2026-11-23" }), ev({ threat: "ballistic" })]);
    expect(merged.map((e) => e.date)).toEqual(["2026-11-23", "2026-11-22", "2026-11-22"]);
  });
});

describe("eventCount and reliability", () => {
  it("prefers the official figure when there is one", () => {
    const e = ev({ sources: [src(), src({ official: false, name: "Other", url: "u2", intercepted: 90 })] });
    expect(eventCount(e, "intercepted")).toEqual({ low: 71, high: 71 });
    expect(reliability(e)).toBe("official");
  });
  it("gives the range across unofficial sources", () => {
    const e = ev({
      sources: [
        src({ official: false, name: "A", intercepted: 10 }),
        src({ official: false, name: "B", url: "u2", intercepted: 14 }),
      ],
    });
    expect(eventCount(e, "intercepted")).toEqual({ low: 10, high: 14 });
    expect(reliability(e)).toBe("corroborated");
    expect(reliability(ev({ sources: [src({ official: false })] }))).toBe("single");
  });
  it("totals and charts the lower figure", () => {
    const e = ev({
      sources: [
        src({ official: false, name: "A", intercepted: 10 }),
        src({ official: false, name: "B", url: "u2", intercepted: 14 }),
      ],
    });
    expect(totals([e, ev()]).intercepted).toEqual({ low: 81, high: 85 });
    const days = dailySeries([e], "2026-11-23", 3);
    expect(days.map((d) => d.total)).toEqual([0, 10, 0]);
  });
});

describe("validate (live extraction)", () => {
  const items: Item[] = [
    {
      kind: "telegram",
      name: "Ukrainian Air Force",
      url: "https://t.me/kpszsu/30120",
      posted: "2026-11-23T06:41:12+00:00",
      official: true,
      text: "У ніч на 23 листопада противник атакував 87 ударними БпЛА. Збито/подавлено 71 ворожий БпЛА.",
    },
  ];
  const raw = {
    item: 1,
    date: "2026-11-22",
    theater: "ukraine",
    defender: "Ukraine",
    threat: "drone",
    launched: 87,
    intercepted: 71,
    systems: [],
    usInvolved: false,
    quote: "Збито/подавлено 71 ворожий БпЛА",
  };
  it("accepts a quoted count", () => {
    const out = validate(raw, items);
    expect(typeof out).toBe("object");
    expect((out as LiveEvent).id).toBe("2026-11-22-ukraine-ukraine-drone");
  });
  it("throws out made-up quotes, missing counts, impossible counts and odd dates", () => {
    expect(validate({ ...raw, quote: "shot down 71 drones" }, items)).toBe("quote not found verbatim");
    expect(validate({ ...raw, launched: null, intercepted: null }, items)).toBe("no count");
    expect(validate({ ...raw, intercepted: 90 }, items)).toBe("more intercepted than launched");
    expect(validate({ ...raw, date: "2026-11-24" }, items)).toMatch(/doesn't fit/);
    expect(validate({ ...raw, date: "2026-11-01" }, items)).toMatch(/doesn't fit/);
    expect(validate({ ...raw, item: 2 }, items)).toBe("no item 2");
  });
});
