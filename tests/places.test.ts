import { describe, expect, it } from "vitest";
import { locate, mapData } from "../src/lib/places";
import { getDrones, getLive } from "../src/lib/data";
import type { LiveEvent } from "../src/lib/live";
import type { DroneClaim } from "../src/lib/drones";

describe("locate", () => {
  it("prefers the most specific place", () => {
    expect(locate("near the Strait of Hormuz, Iran")?.name).toBe("Strait of Hormuz");
    expect(locate("Prince Sultan Air Base, Saudi Arabia")?.name).toBe("Prince Sultan Air Base");
    expect(locate("Over Iran")?.name).toBe("Iran");
    expect(locate("Saudi-led coalition")?.name).toBe("Saudi Arabia");
  });
  it("doesn't read Iran into Iranian, or Oman into woman", () => {
    expect(locate("two Iranian drones")).toBeUndefined();
    expect(locate("a woman was hurt")).toBeUndefined();
    expect(locate("")).toBeUndefined();
    expect(locate("United States")).toBeUndefined();
  });
});

describe("mapData", () => {
  const ev = (over: Partial<LiveEvent>, quote: string): LiveEvent => ({
    id: "x",
    date: "2026-11-13",
    theater: "gulf",
    defender: "United States",
    threat: "drone",
    systems: [],
    usInvolved: true,
    sources: [
      {
        kind: "news",
        name: "example.com",
        url: "https://example.com/a",
        posted: "2026-11-13T10:00:00Z",
        official: false,
        launched: null,
        intercepted: 2,
        quote,
      },
    ],
    ...over,
  });
  const { jets } = getDrones();

  it("places a U.S. intercept where the drones were headed, not where they came from", () => {
    const { marks, unplaced } = mapData(
      [
        ev({}, "it shot down two Iranian drones heading towards Bahrain"),
        ev({ date: "2026-11-14" }, "intercepted two Iranian attack munitions"),
      ],
      { ...jets, losses: [] },
      [],
    );
    expect(marks).toEqual([expect.objectContaining({ kind: "intercept", place: "Bahrain", count: 2 })]);
    expect(unplaced).toEqual(["2026-11-14: United States, 2 drones intercepted"]);
  });

  it("leaves Ukraine and damaged jets off, and puts confirmed losses where they happened", () => {
    const { marks } = mapData([ev({ theater: "ukraine", defender: "Ukraine" }, "shot down 40 drones")], jets, []);
    expect(marks.map((m) => `${m.kind}:${m.place}:${m.count}`).sort()).toEqual([
      "jet-lost:Iran:1",
      "jet-lost:Kuwait:3",
      "jet-lost:Strait of Hormuz:1",
    ]);
  });

  it("lists a claim with no place under the map", () => {
    const claim: DroneClaim = {
      id: "c",
      date: "2026-11-20",
      aircraft: "mq9",
      claimant: "IRGC",
      place: "",
      count: 1,
      tally: 57,
      video: false,
      usConfirmed: false,
      sources: [
        { kind: "telegram", name: "x", url: "https://t.me/x/1", posted: "2026-11-20T00:00:00Z", quote: "an MQ-9 down" },
      ],
    };
    const { marks, unplaced } = mapData([], { ...jets, losses: [] }, [
      claim,
      { ...claim, id: "d", place: "Marib, Yemen" },
    ]);
    expect(marks).toEqual([expect.objectContaining({ kind: "claim", place: "Marib" })]);
    expect(unplaced).toEqual(["2026-11-20: IRGC claims an MQ-9"]);
  });

  it("runs on the real data", () => {
    expect(() => mapData(getLive().events, jets, [])).not.toThrow();
  });
});
