import { describe, expect, it } from "vitest";
import { getDataset, getDroneClaims, getDrones } from "../src/lib/data";
import {
  acknowledged,
  jetModel,
  jetSummary,
  claimedTotal,
  fleetEstimate,
  lossSeries,
  lossesBy,
  mergeClaims,
  type DroneClaim,
} from "../src/lib/drones";
import { mentionsUsAircraft, mentionsUsDrone, mentionsUsJet, validateClaim } from "../scripts/live/losses";
import type { Item } from "../scripts/live/extract";
import { DRONES, quoteTargets, strictIdsFromChanged } from "../scripts/quotes";
import { parseChannelPage } from "../scripts/live/telegram";

const { drones } = getDrones();
const mq9 = drones.find((d) => d.id === "mq9")!;
const mq1 = drones.find((d) => d.id === "mq1")!;

function claim(over: Partial<DroneClaim>): DroneClaim {
  return {
    id: "x",
    date: "2026-11-10",
    aircraft: "mq9",
    claimant: "IRGC",
    place: "",
    count: 1,
    tally: null,
    video: false,
    usConfirmed: false,
    sources: [
      {
        kind: "telegram",
        name: "OSINTdefender",
        url: "https://t.me/a/1",
        posted: "2026-11-10T08:00:00Z",
        quote: "quote text",
      },
    ],
    ...over,
  };
}

describe("data/drones.json", () => {
  it("loads, and the claim log parses", () => {
    expect(drones.map((d) => d.id)).toEqual(["mq9", "mq1"]);
    expect(getDroneClaims().claims).toBeInstanceOf(Array);
  });

  it("puts every figure in the quote check", () => {
    const t = quoteTargets(getDataset(), undefined, getDrones()).filter((x) => x.id === DRONES);
    const { jets } = getDrones();
    const n =
      getDrones().warDamage.sources.length +
      jets.losses.length +
      jets.tallies.length +
      drones.reduce((k, d) => k + (d.fleetBefore ? 1 : 0) + d.fleetAfter.length + d.losses.length, 0);
    expect(t).toHaveLength(n);
    expect(strictIdsFromChanged(["data/drones.json"], getDataset()).has(DRONES)).toBe(true);
  });
});

describe("U.S.-acknowledged losses", () => {
  it("takes the highest running total for the MQ-9: at least 45", () => {
    expect(acknowledged(mq9)).toMatchObject({ value: 45, qualifier: "at-least" });
  });
  it("adds September's two MQ-1s to May's one", () => {
    expect(acknowledged(mq1)).toMatchObject({ value: 3, qualifier: "at-least" });
  });
});

describe("claimed total", () => {
  const base = lossesBy(mq9, "adversary").at(-1)!;
  it("starts from the Guards' 56th", () => {
    expect(claimedTotal(base, [], "mq9")).toEqual({ value: 56, asOf: "2026-11-04" });
  });
  it("adds claims without a running count and jumps to a stated one", () => {
    const log = [
      claim({ date: "2026-11-08" }),
      claim({ date: "2026-11-12", tally: 60 }),
      claim({ date: "2026-11-14", count: 2 }),
      claim({ date: "2026-11-01" }), // before the baseline: already in it
      claim({ date: "2026-11-15", aircraft: "mq1" }),
    ];
    expect(claimedTotal(base, log, "mq9")).toEqual({ value: 62, asOf: "2026-11-14" });
  });
  it("never lets a stated count take the total down", () => {
    expect(claimedTotal(base, [claim({ tally: 50 })], "mq9")!.value).toBe(56);
  });
});

describe("fleet estimate", () => {
  it("is 165 less at least 45 by U.S. count, and 165 less 56 if every claim holds", () => {
    const e = fleetEstimate(mq9, []);
    expect(e.acknowledged).toMatchObject({ value: 120, qualifier: "at-most" });
    expect(e.ifClaimsTrue).toMatchObject({ value: 109 });
  });
  it("has none for the MQ-1, whose fleet isn't published", () => {
    expect(fleetEstimate(mq1, [])).toEqual({});
  });
  it("charts the drop from 165 to 135 as 30 lost", () => {
    const s = lossSeries(mq9, []);
    expect(s.us.find((p) => p.date === "2026-05-12")!.value).toBe(30);
    expect(s.claimed.at(-1)!.value).toBe(56);
  });
});

describe("mergeClaims", () => {
  it("treats the same running count, or the same drone and day, as one claim", () => {
    const a = claim({ tally: 57, date: "2026-11-10" });
    const b = claim({
      tally: null,
      date: "2026-11-10",
      video: true,
      sources: [{ ...a.sources[0], url: "https://t.me/a/2" }],
    });
    const c = claim({ tally: 57, date: "2026-11-11", sources: [{ ...a.sources[0], url: "https://t.me/a/3" }] });
    const out = mergeClaims([a], [b, c]);
    expect(out).toHaveLength(1);
    expect(out[0].sources).toHaveLength(3);
    expect(out[0].video).toBe(true);
  });
  it("keeps different drones on the same day apart", () => {
    expect(mergeClaims([claim({})], [claim({ aircraft: "mq1" })])).toHaveLength(2);
  });
});

describe("mentionsUsDrone", () => {
  it("finds MQ-9s and MQ-1s in English, Arabic and Persian", () => {
    expect(mentionsUsDrone("IRGC says it shot down an MQ-9 Reaper")).toBe(true);
    expect(mentionsUsDrone("an MQ-1C Gray Eagle was lost")).toBe(true);
    expect(mentionsUsDrone("إسقاط طائرة أمريكية نوع إم كيو 9")).toBe(true);
    expect(mentionsUsDrone("سرنگونی پهپاد ام‌کیو ۹ آمریکایی")).toBe(true);
  });
  it("skips other drones", () => {
    expect(mentionsUsDrone("Bahrain intercepted 4 Shahed drones")).toBe(false);
    expect(mentionsUsDrone("MQ-25 tanker test flight")).toBe(false);
  });
});

describe("validateClaim", () => {
  const item: Item = {
    kind: "telegram",
    name: "OSINTdefender",
    url: "https://t.me/OSINTdefender/1",
    posted: "2026-11-20T09:00:00Z",
    official: false,
    text: "Iran's IRGC claims to have shot down a U.S. MQ-9 Reaper drone over the Strait of Hormuz, its 57th.",
    video: true,
  };
  const raw = {
    item: 1,
    date: "2026-11-20",
    aircraft: "mq9",
    model: "",
    claimant: "IRGC",
    place: "Strait of Hormuz",
    count: 1,
    tally: 57,
    video: false,
    usConfirmed: false,
    quote: "shot down a U.S. MQ-9 Reaper drone over the Strait of Hormuz",
  };
  it("keeps a verbatim claim and marks an attached video", () => {
    const c = validateClaim(raw, [item]);
    expect(typeof c).toBe("object");
    expect((c as DroneClaim).video).toBe(true);
    expect((c as DroneClaim).tally).toBe(57);
  });
  it("throws out a paraphrase, a quote with no drone, and an old date", () => {
    expect(validateClaim({ ...raw, quote: "downed a Reaper near Hormuz" }, [item])).toBe("quote not found verbatim");
    expect(validateClaim({ ...raw, quote: "over the Strait of Hormuz, its 57th" }, [item])).toMatch(/doesn't name/);
    expect(validateClaim({ ...raw, date: "2026-11-01" }, [item])).toMatch(/doesn't fit/);
  });
});

describe("parseChannelPage video flag", () => {
  it("marks posts with a video attached", () => {
    const html = `<div class="tgme_widget_message_wrap"><div data-post="chan/5"><a class="tgme_widget_message_video_player"><video class="tgme_widget_message_video"></video></a><div class="tgme_widget_message_text js-message_text">MQ-9 down</div><time datetime="2026-11-20T09:00:00+00:00"></time></div></div>`;
    expect(parseChannelPage(html, "chan")[0].video).toBe(true);
  });
});

describe("jets", () => {
  const { jets } = getDrones();
  it("counts two shot down by Iran and three by friendly fire, and leaves the damaged F-35 out", () => {
    expect(jetSummary(jets, [])).toEqual({ shotDown: 2, friendlyFire: 3, claimed: 0, claimedTo: undefined });
  });
  it("adds logged jet claims, but not drone claims", () => {
    const log = [
      claim({ aircraft: "jet", model: "F-35", date: "2026-11-20" }),
      claim({ aircraft: "jet", model: "F-15E", date: "2026-11-21", count: 2 }),
      claim({}),
    ];
    expect(jetSummary(jets, log)).toMatchObject({ claimed: 3, claimedTo: "2026-11-21" });
  });
  it("tells claimed jet types apart, and merges the same type on the same day", () => {
    expect(jetModel("F-35A Lightning II")).toBe("f-35");
    expect(jetModel("f35")).toBe("f-35");
    expect(jetModel("F/A-18")).toBe("f/a-18");
    expect(jetModel("fighter jet")).toBe("jet");
    const a = claim({ aircraft: "jet", model: "F-35A", date: "2026-11-20" });
    const b = claim({
      aircraft: "jet",
      model: "F-35",
      date: "2026-11-20",
      sources: [{ ...a.sources[0], url: "https://t.me/a/9" }],
    });
    const c = claim({ aircraft: "jet", model: "F-16", date: "2026-11-20" });
    expect(mergeClaims([a], [b, c])).toHaveLength(2);
  });
  it("finds jets in English, Arabic and Persian, without catching everyday numbers", () => {
    expect(mentionsUsJet("Iran says it shot down a US F-35 over Isfahan")).toBe(true);
    expect(mentionsUsJet("An F/A-18 was lost")).toBe(true);
    expect(mentionsUsJet("إسقاط مقاتلة أمريكية إف 16")).toBe(true);
    expect(mentionsUsJet("سرنگونی جنگنده آمریکایی")).toBe(true);
    expect(mentionsUsJet("Bahrain intercepted 4 Shahed drones")).toBe(false);
    expect(mentionsUsJet("prices rose by A 10 percent in Q3")).toBe(false);
    expect(mentionsUsAircraft("MQ-9 down")).toBe(true);
  });
  it("keeps a jet claim only when its quote names a jet", () => {
    const item: Item = {
      kind: "telegram",
      name: "Middle East Spectator",
      url: "https://t.me/Middle_East_Spectator/1",
      posted: "2026-11-20T09:00:00Z",
      official: false,
      text: "BREAKING: IRGC says its air defenses shot down a US F-35 fighter jet over Bushehr.",
    };
    const raw = {
      item: 1,
      date: "2026-11-20",
      aircraft: "jet",
      model: "F-35",
      claimant: "IRGC",
      place: "Bushehr",
      count: 1,
      tally: null,
      video: false,
      usConfirmed: false,
      quote: "shot down a US F-35 fighter jet over Bushehr",
    };
    const c = validateClaim(raw, [item]) as DroneClaim;
    expect(c.model).toBe("F-35");
    expect(c.id).toBe("jet-2026-11-20-f-35");
    expect(validateClaim({ ...raw, quote: "its air defenses shot down" }, [item])).toBe("quote doesn't name a jet");
  });
});

describe("war damage", () => {
  it("adds up to the 81 aircraft the Congressional Research Service counts", () => {
    const w = getDrones().warDamage;
    expect(w.total).toBe(81);
    expect(w.categories.reduce((n, c) => n + c.value, 0)).toBe(81);
  });
});
