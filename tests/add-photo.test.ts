import { describe, expect, it } from "vitest";
import photosJson from "../data/photos.json";
import { captionLead } from "../src/lib/format";
import { creditFrom, parseDvidsPage } from "../scripts/add-photo";

const page = (credit: string, unit: string, extra: string[]) => `<html><head>
<meta property="og:image" content="https://d1ldvf68ux039x.cloudfront.net/thumbs/photos/2507/9218012/1000w_q95.jpg">
</head><body><p>07.31.2009</p><p>${credit}</p><p>${unit}</p><p>✔</p>
${extra.map((e) => `<p>${e}</p>`).join("")}
<p>IMAGE INFO</p><p>PUBLIC DOMAIN</p></body></html>`;

describe("parseDvidsPage", () => {
  it("takes the long caption, not a short credit line just above IMAGE INFO", () => {
    const p = parseDvidsPage(
      page("Courtesy Photo", "War.gov", [
        "The destroyer USS Hopper (DDG 70) launches a Standard Missile-3 as it operates in the Pacific Ocean on July 30, 2009.",
        "(DoD photo by U.S. Navy. (Released))",
      ]),
      "https://www.dvidshub.net/image/9218012/destroyer-uss-hopper",
    );
    expect(p.caption).toMatch(/^The destroyer USS Hopper/);
    expect(p.credit).toBe("U.S. Navy");
    expect(p.taken).toBe("2009-07-31");
    expect(p.imageUrl).toMatch(/\/2000w_q95\.jpg$/);
    expect(p.publicDomain).toBe(true);
  });

  it("rejects a URL that isn't a DVIDS image page", () => {
    expect(() => parseDvidsPage(page("Photo by A", "B", []), "https://example.com/x")).toThrow(/not a DVIDS image/);
  });
});

describe("creditFrom", () => {
  it("prefers a named photographer", () => {
    expect(creditFrom("Photo by David Poe", "Fort Bliss Public Affairs Office", "")).toBe(
      "David Poe, Fort Bliss Public Affairs Office",
    );
    expect(
      creditFrom("Courtesy Photo", "Space Launch Delta 30", "launches. (U.S. Space Force Photo by Anthony Mendez)"),
    ).toBe("Anthony Mendez, U.S. Space Force");
  });

  it("falls back to the branch, then the unit", () => {
    expect(
      creditFrom("Courtesy Photo", "U.S. Central Command Public Affairs", "Feb. 28, 2026. (U.S. Navy photo)"),
    ).toBe("U.S. Navy, U.S. Central Command Public Affairs");
    expect(creditFrom("Courtesy Photo", "Missile Defense Agency", "A THAAD interceptor is launched.")).toBe(
      "Missile Defense Agency",
    );
  });
});

describe("captionLead", () => {
  it("cuts each stored caption at the end of its dated first sentence, not at an abbreviation", () => {
    const leads = Object.fromEntries(
      Object.entries(photosJson).map(([id, p]) => [id, captionLead((p as { caption: string }).caption)]),
    );
    expect(leads.patriot).toBe(
      "A PATRIOT missile launches into the sky over the Fort Bliss Training Complex in New Mexico, Sept. 19, 2026.",
    );
    expect(leads.tomahawk).toMatch(/Delbert D\. Black .* Feb\. 28, 2026\.$/);
    expect(leads.jassm).toMatch(/Barksdale Air Force Base, La\., Jan\. 28, 2021\.$/);
    for (const lead of Object.values(leads)) expect(lead).toMatch(/\d{4}\.$/);
  });

  it("falls back to a trimmed caption when there is no dated sentence", () => {
    expect(captionLead("No date here")).toBe("No date here");
    expect(captionLead("x".repeat(400))).toHaveLength(318);
  });
});
