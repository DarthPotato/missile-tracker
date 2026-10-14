import { describe, expect, it } from "vitest";
import { getDataset, getPerspective } from "../src/lib/data";
import {
  checkQuotes,
  healthLines,
  PERSPECTIVE,
  quoteTargets,
  strictIdsFromChanged,
  summarize,
  type QuoteTarget,
} from "../scripts/quotes";

const page = (text: string) => async () => text;
const target = (over: Partial<QuoteTarget> = {}): QuoteTarget => ({
  id: "r1",
  url: "https://example.com/a",
  quotes: ["about 700 Patriot interceptors left"],
  manual: false,
  ...over,
});

describe("checkQuotes", () => {
  it("passes when every quote is on its page", async () => {
    const r = await checkQuotes([target()], page("Officials say there are about 700 Patriot interceptors left."));
    expect(r.ok).toBe(true);
    expect(r.found).toBe(1);
  });

  it("fails and names the report and quote when a quote is missing", async () => {
    const r = await checkQuotes([target()], page("Officials say there are roughly 700 Patriots left."));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([{ id: "r1", quote: "about 700 Patriot interceptors left" }]);
  });

  it("fails when a fetcher always throws", async () => {
    const r = await checkQuotes([target(), target({ id: "r2", url: "https://example.com/b" })], async () => {
      throw new Error("offline");
    });
    expect(r.ok).toBe(false);
    expect(r.unreachable).toHaveLength(2);
  });

  it("fails when nothing is reachable even if every source is lenient", async () => {
    const r = await checkQuotes(
      [target()],
      async () => {
        throw new Error("offline");
      },
      { strict: () => false },
    );
    expect(r.ok).toBe(false);
  });

  it("lets the escape hatch pass an offline run", async () => {
    const r = await checkQuotes(
      [target()],
      async () => {
        throw new Error("offline");
      },
      { strict: () => false, allowNoneReachable: true },
    );
    expect(r.ok).toBe(true);
    expect(r.unreachable).toHaveLength(1);
  });

  it("tolerates a lenient unreachable source when others were checked", async () => {
    const fetcher = async (url: string) => {
      if (url.endsWith("/b")) throw new Error("HTTP 403");
      return "about 700 Patriot interceptors left";
    };
    const r = await checkQuotes([target(), target({ id: "old", url: "https://example.com/b" })], fetcher, {
      strict: (id) => id !== "old",
    });
    expect(r.ok).toBe(true);
    expect(r.unreachable[0]).toMatchObject({ id: "old", strict: false });
  });

  it("skips manual targets without fetching and fetches a shared URL once", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return "about 700 Patriot interceptors left";
    };
    const r = await checkQuotes([target(), target({ id: "r2" }), target({ id: "pdf", manual: true })], fetcher);
    expect(calls).toBe(1);
    expect(r.manual).toEqual(["pdf"]);
    expect(summarize(r)).toBe("quotes: 2 found, 0 missing, 0 sources unreachable, 1 manual");
  });

  it("passes trivially when there is nothing to fetch", async () => {
    const r = await checkQuotes([target({ manual: true })], async () => {
      throw new Error("should not be called");
    });
    expect(r.ok).toBe(true);
  });
});

describe("healthLines (the watcher's non-blocking report on old sources)", () => {
  it("lists a vanished quote and an unreachable page without failing anything", async () => {
    const fetcher = async (url: string) => {
      if (url.endsWith("/gone")) throw new Error("HTTP 404");
      return "the article was edited";
    };
    const r = await checkQuotes([target(), target({ id: "gone", url: "https://example.com/gone" })], fetcher, {
      strict: () => false,
      allowNoneReachable: true,
    });
    const lines = healthLines(r);
    expect(lines[0]).toMatch(/\*\*r1\*\*: quote no longer found/);
    expect(lines[1]).toMatch(/\*\*gone\*\*: couldn't fetch .*HTTP 404/);
  });
});

describe("quoteTargets / strictIdsFromChanged", () => {
  const ds = getDataset();

  it("includes model-input quotes under the report they cite", () => {
    const t = quoteTargets(ds).find((x) => x.id === "2026-05-27-csis-rebuilding")!;
    expect(t.quotes).toContain("The Army has requested 857 THAAD interceptors in FY 2027.");
  });

  it("adds the perspective page's figures", () => {
    const t = quoteTargets(ds, getPerspective()).filter((x) => x.id === PERSPECTIVE);
    expect(t.length).toBeGreaterThan(0);
  });

  it("maps changed files to the sources that must be reachable", () => {
    const ids = strictIdsFromChanged(
      ["data/reports/2026-07-27-csis-renewed-war.json", "data/perspective.json", "README.md"],
      ds,
    );
    expect([...ids].sort()).toEqual(["2026-07-27-csis-renewed-war", PERSPECTIVE]);
    // munitions.json makes every report it cites strict
    expect(strictIdsFromChanged(["data/munitions.json"], ds).has("2026-05-27-csis-rebuilding")).toBe(true);
  });
});
