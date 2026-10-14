import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { extract, reportId, SCHEMA } from "../scripts/pipeline/extract";

// A stand-in client that returns a canned structured-output response, so the
// post-processing (quote check, schema check) is tested without an API call.
function fakeClient(payload: unknown, stop_reason = "end_turn") {
  return {
    messages: {
      // Thinking blocks come first on Haiku 5.5; the text block carries the JSON.
      create: async () => ({
        stop_reason,
        content: [
          { type: "thinking", thinking: "", signature: "x" },
          { type: "text", text: JSON.stringify(payload) },
        ],
      }),
    },
  } as unknown as Anthropic;
}

const article = {
  url: "https://example.com/story",
  title: "Interceptors run low",
  outlet: "Example News",
  published: "2026-10-12",
  text: "Officials said the Army has about 700 Patriot interceptors left. Another paragraph about weather.",
};

const claim = {
  munition: "patriot",
  metric: "remaining",
  low: 700,
  high: 700,
  qualifier: "about",
  asOf: "2026-10-12",
  confidence: "reported",
  quote: "the Army has about 700 Patriot interceptors left",
  attribution: "officials",
  note: null,
};

describe("extract", () => {
  it("keeps claims whose quote is on the page", async () => {
    const r = await extract(article, fakeClient({ relevant: true, summary: "Reports a new Patriot count from officials.", claims: [claim] }));
    expect(r.report?.claims).toHaveLength(1);
    expect(r.report?.addedBy).toBe("pipeline");
    expect(r.report?.claims[0].note).toBeUndefined();
  });

  it("drops claims whose quote was paraphrased", async () => {
    const r = await extract(
      article,
      fakeClient({ relevant: true, summary: "Reports a new Patriot count.", claims: [{ ...claim, quote: "the Army has roughly 700 Patriots left" }] }),
    );
    expect(r.report).toBeUndefined();
    expect(r.dropped[0].reason).toMatch(/verbatim/);
  });

  it("drops claims that fail the schema", async () => {
    const r = await extract(article, fakeClient({ relevant: true, summary: "Reports a new Patriot count.", claims: [{ ...claim, low: 900, high: 700 }] }));
    expect(r.report).toBeUndefined();
    expect(r.dropped).toHaveLength(1);
  });

  it("clamps an asOf after publication to the publication date", async () => {
    const r = await extract(article, fakeClient({ relevant: true, summary: "Reports a new Patriot count.", claims: [{ ...claim, asOf: "2026-12-01" }] }));
    expect(r.report?.claims[0].asOf).toBe("2026-10-12");
  });

  it("marks reports built from partial text for a manual quote check", async () => {
    const r = await extract({ ...article, partial: true }, fakeClient({ relevant: true, summary: "Reports a new Patriot count.", claims: [claim] }));
    expect(r.report?.quoteCheck).toBe("manual");
  });

  it("handles a refusal without throwing", async () => {
    const r = await extract(article, fakeClient({}, "refusal"));
    expect(r.report).toBeUndefined();
  });

  it("builds a stable slug id", () => {
    expect(reportId(article)).toBe("2026-10-12-example-news-interceptors-run-low");
  });

  it("never declares an enum on a multi-type field (the API rejects it)", () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if ("enum" in n) expect(typeof n.type, JSON.stringify(n)).toBe("string");
      Object.values(n).forEach(walk);
    };
    walk(SCHEMA);
  });
});
