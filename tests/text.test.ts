import { describe, expect, it } from "vitest";
import { containsQuote, htmlToText, normalizeForMatch } from "../src/lib/text";

describe("htmlToText", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(htmlToText("<p>Pentagon&rsquo;s &#8217;s &#x2019;s &amp; &quot;x&quot;</p>")).toBe("Pentagon’s ’s ’s & \"x\"");
  });

  it("drops scripts, styles and comments", () => {
    const html = "<style>.a{}</style><script>var leak = 'quote';</script><!-- hidden --><p>Visible text</p>";
    expect(htmlToText(html)).toBe("Visible text");
  });

  it("keeps paragraph breaks and collapses spaces", () => {
    expect(htmlToText("<p>One   two</p><p>three</p>")).toBe("One two\nthree");
  });
});

describe("normalizeForMatch / containsQuote", () => {
  it("normalizes case, quote marks, dashes, ellipses and whitespace", () => {
    expect(normalizeForMatch("“NOT TRUE” — 1,060–1,430…\n done")).toBe('"not true" - 1,060-1,430... done');
  });

  it("matches curly quotes and en dashes in a quote against straight characters on the page", () => {
    const page = 'Hegseth called it "NOT TRUE." Estimates range 1,060-1,430.';
    expect(containsQuote(page, "Hegseth called it “NOT TRUE.”")).toBe(true);
    expect(containsQuote(page, "range 1,060–1,430")).toBe(true);
  });

  it("matches across line breaks in the page", () => {
    expect(containsQuote("about 700\nPatriot interceptors", "about 700 Patriot interceptors")).toBe(true);
  });

  it("does not match a paraphrase", () => {
    const page = "The U.S. has an estimated 234 to 278 THAAD interceptors remaining.";
    expect(containsQuote(page, "The U.S. has roughly 234 to 278 THAAD interceptors left.")).toBe(false);
    expect(containsQuote(page, "234-278 THAAD interceptors remaining")).toBe(false);
  });
});
