import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchChannel,
  parseChannelPage,
  looksLikeIntercept,
  looksLikeTally,
  worthSending,
} from "../scripts/live/telegram";
import { validate, type Item } from "../scripts/live/extract";
import {
  LiveFile,
  dailySeries,
  defenderName,
  eventCount,
  latestTotals,
  mergeEvents,
  mergeTotals,
  totalCount,
  whoseTotal,
  type RunningTotal,
  reliability,
  totals,
  whoseCounts,
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

describe("worthSending", () => {
  const alert = "Група ударних БпЛА на Сумщині, курсом на Конотоп";
  const tally = "протиповітряною обороною збито/подавлено 88 ворожих БпЛА";
  it("sends only tallies from an official channel", () => {
    expect(worthSending(alert, true)).toBe(false);
    expect(worthSending(tally, true)).toBe(true);
  });
  it("keeps the looser filter for other channels", () => {
    expect(worthSending("Saudi air defenses intercept three Houthi drones", false)).toBe(true);
    expect(worthSending("Weather update", false)).toBe(false);
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

  it("stops a backfill at its deadline and keeps what it read", async () => {
    stub();
    const posts = (await run(fetchChannel("kpszsu", 0, { since: "2026-11-01", deadline: 0 }))) as { id: number }[];
    expect(posts.map((p) => p.id)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    expect(calls).toHaveLength(1);
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
  it("adds up an official channel's separate posts on the same day", () => {
    // Ukraine's Air Force: the daytime wave in the evening, the overnight one next morning.
    const e = ev({
      sources: [
        src({ url: "u1", launched: 168, intercepted: 122 }),
        src({ url: "u2", launched: 433, intercepted: 371 }),
        src({ official: false, name: "Other", url: "u3", intercepted: 90 }),
      ],
    });
    expect(eventCount(e, "intercepted")).toEqual({ low: 493, high: 493 });
    expect(eventCount(e, "launched")).toEqual({ low: 601, high: 601 });
  });
  it("gives no launched count when an official post leaves it out", () => {
    const e = ev({
      sources: [
        src({ url: "u1", launched: 326, intercepted: 274 }),
        src({ url: "u2", launched: null, intercepted: 154 }),
      ],
    });
    expect(eventCount(e, "intercepted")).toEqual({ low: 428, high: 428 });
    expect(eventCount(e, "launched")).toBeUndefined();
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
    countFrom: null,
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

describe("whoseCounts", () => {
  const src = (over: Partial<LiveSource>): LiveSource => ({
    kind: "news",
    name: "Gulf News",
    url: `https://example.com/${Math.random()}`,
    posted: "2026-04-03",
    official: false,
    launched: 19,
    intercepted: 19,
    quote: "intercepted 19 ballistic missiles",
    ...over,
  });
  const ev = (defender: string, sources: LiveSource[]): LiveEvent => ({
    id: "x",
    date: "2026-04-02",
    theater: defender === "Israel" ? "israel" : "gulf",
    defender,
    threat: "ballistic",
    systems: [],
    usInvolved: false,
    sources,
  });
  it("credits the government a report quotes, not the outlet", () => {
    expect(whoseCounts([ev("UAE", [src({ countFrom: "UAE Ministry of Defence" })])])).toBe("UAE Ministry of Defence");
  });
  it("credits an official channel's count to the defender, and lists the most frequent first", () => {
    const israel = ev("Israel", [src({ name: "IDF", official: true })]);
    const us = ev("United States", [src({ name: "CENTCOM", official: true })]);
    expect(whoseCounts([us, israel, { ...israel, id: "y" }])).toBe("Israel and the United States");
  });
  it("falls back to the outlet, and ignores sources without a launch count", () => {
    const e = ev("UAE", [src({ name: "OSINTdefender" }), src({ name: "Reuters", launched: null })]);
    expect(whoseCounts([e])).toBe("OSINTdefender");
  });
});

describe("running totals", () => {
  const items: Item[] = [
    {
      kind: "news",
      name: "news.webindia123.com",
      url: "https://news.webindia123.com/a",
      posted: "2026-03-21T18:30:00Z",
      official: false,
      text: "UAE air defences intercepted 341 ballistic missiles since start of West Asia conflict",
    },
  ];
  const raw = {
    item: 1,
    date: "2026-03-21",
    theater: "gulf",
    defender: "UAE",
    threat: "ballistic",
    launched: null,
    intercepted: 341,
    systems: [],
    usInvolved: false,
    countFrom: "UAE Ministry of Defence",
    runningTotal: true,
    since: "the war began",
    quote: "UAE air defences intercepted 341 ballistic missiles",
  };
  it("validate turns a running total into a total, not an event", () => {
    const out = validate(raw, items) as RunningTotal;
    expect(out.asOf).toBe("2026-03-21");
    expect(out.since).toBe("the war began");
    expect(out.id).toBe("total-2026-03-21-gulf-uae-ballistic");
    expect("date" in out).toBe(false);
    expect((validate({ ...raw, runningTotal: false }, items) as LiveEvent).date).toBe("2026-03-21");
  });
  const t = (over: Partial<RunningTotal>, n: number, official = false): RunningTotal => ({
    id: "total-x",
    asOf: "2026-03-21",
    theater: "gulf",
    defender: "UAE",
    threat: "ballistic",
    since: "the war began",
    sources: [
      {
        kind: "news",
        name: official ? "UAE MoD" : "Gulf News",
        url: `https://example.com/${n}-${official}`,
        posted: "2026-03-21",
        official,
        launched: null,
        intercepted: n,
        quote: "intercepted many missiles",
      },
    ],
    ...over,
  });
  it("merges sources on the same total and never adds them up", () => {
    const merged = mergeTotals([t({}, 341)], [t({}, 345)]);
    expect(merged).toHaveLength(1);
    expect(totalCount(merged[0], "intercepted")).toEqual({ low: 341, high: 345 });
    expect(totalCount(merged[0], "launched")).toBeUndefined();
    const withOfficial = mergeTotals(merged, [t({}, 340, true)]);
    expect(totalCount(withOfficial[0], "intercepted")).toEqual({ low: 340, high: 340 });
    expect(whoseTotal(withOfficial[0])).toBe("the UAE");
  });
  it("keeps the newest total per country and weapon, in the theaters asked for", () => {
    const list = [
      t({ asOf: "2026-03-10" }, 200),
      t({ asOf: "2026-03-21" }, 341),
      t({ threat: "drone" }, 1748),
      t({ theater: "ukraine", defender: "Ukraine" }, 5),
    ];
    const latest = latestTotals(list, ["gulf"]);
    expect(latest.map((x) => totalCount(x, "intercepted")!.low).sort((a, b) => a - b)).toEqual([341, 1748]);
  });
  it("credits who the report names, and old files without totals still load", () => {
    expect(whoseTotal(t({}, 1))).toBe("Gulf News");
    expect(LiveFile.parse({ updated: null, events: [] }).totals).toEqual([]);
  });
});

describe("country names", () => {
  it("gives each country one name", () => {
    expect(defenderName("United Arab Emirates")).toBe("UAE");
    expect(defenderName("the UAE")).toBe("UAE");
    expect(defenderName("KSA")).toBe("Saudi Arabia");
    expect(defenderName("U.S.")).toBe("United States");
    expect(defenderName("Saudi-led coalition")).toBe("Saudi-led coalition");
    expect(defenderName("Ukraine")).toBe("Ukraine");
  });
  it("merges an event logged under an older name into the same day's report", () => {
    const base = {
      date: "2026-03-07",
      theater: "gulf" as const,
      threat: "drone" as const,
      systems: [] as string[],
      usInvolved: false,
    };
    const src = (url: string, n: number): LiveSource => ({
      kind: "news",
      name: url,
      url: `https://${url}/a`,
      posted: "2026-03-07",
      official: false,
      launched: null,
      intercepted: n,
      quote: "intercepted many drones",
    });
    const old: LiveEvent = {
      ...base,
      id: "2026-03-07-gulf-united-arab-emirates-drone",
      defender: "United Arab Emirates",
      sources: [src("qna.org.qa", 119)],
    };
    const fresh: LiveEvent = {
      ...base,
      id: "2026-03-07-gulf-uae-drone",
      defender: "UAE",
      sources: [src("gulfnews.com", 119)],
    };
    const merged = mergeEvents([old], [fresh]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("2026-03-07-gulf-uae-drone");
    expect(merged[0].sources).toHaveLength(2);
  });
});
