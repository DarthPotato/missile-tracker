import { describe, expect, it } from "vitest";
import { archive, canonicalSnapshot, findSnapshot, rawSnapshot, saveSnapshot } from "../scripts/archive";
import { checkQuotes, type QuoteTarget } from "../scripts/quotes";
import { Report } from "../src/lib/schema";

const URL_ = "https://www.csis.org/analysis/munition-inventories-update-amid-renewed-war-risk";
const SNAP = `https://web.archive.org/web/20261110153000/${URL_}`;

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("snapshot addresses", () => {
  it("normalises http and id_ forms", () => {
    expect(canonicalSnapshot(`http://web.archive.org/web/20261110153000/${URL_}`)).toBe(SNAP);
    expect(canonicalSnapshot(`https://web.archive.org/web/20261110153000id_/${URL_}`)).toBe(SNAP);
    expect(canonicalSnapshot("https://example.com/web/1/x")).toBeUndefined();
  });
  it("builds the raw-page address", () => {
    expect(rawSnapshot(SNAP)).toBe(`https://web.archive.org/web/20261110153000id_/${URL_}`);
  });
});

describe("archive", () => {
  it("uses an existing snapshot near the publication date", async () => {
    const calls: string[] = [];
    const snap = await archive(URL_, "2026-11-10", async (u) => {
      calls.push(String(u));
      return json({
        archived_snapshots: { closest: { available: true, status: "200", url: SNAP.replace("https", "http") } },
      });
    });
    expect(snap).toBe(SNAP);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("timestamp=20261110");
  });

  it("ignores snapshots of error pages", async () => {
    const snap = await findSnapshot(URL_, "2026-11-10", async () =>
      json({ archived_snapshots: { closest: { available: true, status: "403", url: SNAP } } }),
    );
    expect(snap).toBeUndefined();
  });

  it("saves the page when no snapshot exists", async () => {
    const snap = await archive(URL_, "2026-11-10", async (u) => {
      if (String(u).includes("/wayback/available")) return json({ archived_snapshots: {} });
      const res = new Response("ok");
      Object.defineProperty(res, "url", { value: SNAP });
      return res;
    });
    expect(snap).toBe(SNAP);
  });

  it("reads the snapshot from Content-Location when there's no redirect", async () => {
    const snap = await saveSnapshot(URL_, async () => {
      const res = new Response("ok", { headers: { "content-location": `/web/20261110153000/${URL_}` } });
      Object.defineProperty(res, "url", { value: `https://web.archive.org/save/${URL_}` });
      return res;
    });
    expect(snap).toBe(SNAP);
  });
});

describe("quote check fallback", () => {
  const target: QuoteTarget = {
    id: "csis",
    url: URL_,
    archiveUrl: SNAP,
    quotes: ["Patriot $5 million 2,330 1,596–1,697"],
    manual: false,
  };

  it("reads the archived copy when the original refuses", async () => {
    const r = await checkQuotes([target], async (u) => {
      if (u === URL_) throw new Error("HTTP 403");
      expect(u).toBe(rawSnapshot(SNAP));
      return "Patriot $5 million 2,330 1,596–1,697 Late 2029";
    });
    expect(r.ok).toBe(true);
    expect(r.viaArchive).toEqual(["csis"]);
    expect(r.unreachable).toEqual([]);
  });

  it("still reports the original's error when both fail", async () => {
    const r = await checkQuotes([target], async () => {
      throw new Error("HTTP 403");
    });
    expect(r.ok).toBe(false);
    expect(r.unreachable[0].error).toBe("HTTP 403");
  });
});

describe("schema", () => {
  it("accepts only Wayback snapshot addresses", () => {
    const base = {
      id: "r",
      source: { outlet: "X", title: "T", url: URL_, published: "2026-11-10", kind: "news" },
      summary: "a summary of twenty chars",
      claims: [],
      addedBy: "human",
    };
    expect(Report.safeParse({ ...base, source: { ...base.source, archiveUrl: SNAP } }).success).toBe(true);
    expect(
      Report.safeParse({ ...base, source: { ...base.source, archiveUrl: "https://evil.example/x" } }).success,
    ).toBe(false);
  });
});
