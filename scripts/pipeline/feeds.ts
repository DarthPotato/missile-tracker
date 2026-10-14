// Where the daily watcher looks. Each feed returns lightweight items; the
// watcher fetches full text only for items that pass the keyword filter.
import { XMLParser } from "fast-xml-parser";
import { redact } from "../fetch-text.ts";

export interface FeedItem {
  url: string;
  title: string;
  outlet: string;
  published: string; // YYYY-MM-DD
  /** Abstract text when the full page can't be fetched (NYT API, RSS description). */
  abstract?: string;
  kind: "think-tank" | "news" | "government" | "industry";
  /** Contract announcements go in the PR as leads for model inputs, not as claims. */
  lead?: boolean;
  /** The listing had no date; read it from the article. */
  undated?: boolean;
}

const MUNITION_WORDS =
  /\b(patriot|pac-3|thaad|sm-3|sm-6|standard missile|tomahawk|tlam|jassm|precision strike missile|prsm|atacms)\b/i;
const STOCK_WORDS =
  /\b(stockpile|stockpiles|inventor(y|ies)|interceptors?|munitions?|expended|depleted|shortfall|replenish|winchester)\b/i;

export function looksRelevant(text: string): boolean {
  return MUNITION_WORDS.test(text) && STOCK_WORDS.test(text);
}

const xml = new XMLParser({ ignoreAttributes: true, trimValues: true });
const day = (d: string | number | Date) => new Date(d).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = "missile-tracker/0.1 (+https://github.com/DarthPotato/missile-tracker)";

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  // redact(): the NYT API key rides in the query string; never print it.
  if (!res.ok) throw new Error(`HTTP ${res.status} ${redact(url)}`);
  return res.text();
}

/** Parse an RSS 2.0 body; works for a channel with one <item> or many. */
export function parseRss(body: string): { title: string; link: string; pubDate?: string; description?: string }[] {
  const doc = xml.parse(body);
  const items = doc?.rss?.channel?.item ?? [];
  return (Array.isArray(items) ? items : [items]).map((i: Record<string, unknown>) => ({
    title: String(i.title ?? "").trim(),
    link: String(i.link ?? "").trim(),
    pubDate: i.pubDate ? String(i.pubDate) : undefined,
    description: i.description ? String(i.description) : undefined,
  }));
}

/**
 * CSIS's site-wide RSS feed is stale, so watch the analysts who publish the
 * stockpile estimates directly. Listing pages carry no dates; the watcher
 * reads "Published <date>" off each article.
 */
const CSIS_PEOPLE = ["mark-f-cancian", "chris-h-park"];

export async function csis(): Promise<FeedItem[]> {
  const out: FeedItem[] = [];
  for (const person of CSIS_PEOPLE) {
    const html = await get(`https://www.csis.org/people/${person}`);
    for (const [, slug] of html.matchAll(/href="\/analysis\/([a-z0-9-]+)"/g)) {
      out.push({
        url: `https://www.csis.org/analysis/${slug}`,
        title: slug.replace(/-/g, " "),
        outlet: "CSIS",
        published: day(Date.now()),
        kind: "think-tank",
        undated: true,
      });
    }
  }
  return out;
}

/**
 * Bing News RSS returns publisher URLs (inside its click-tracking link).
 * Runs only when USE_BING_NEWS=1: the watch workflow sets that by default
 * (repository variable USE_BING_NEWS=0 turns it off); local runs leave it off
 * unless you set it. Its terms limit the feed to personal, non-commercial
 * aggregation.
 */
/** One Bing RSS item to a FeedItem, or undefined if its links are malformed (skips only that item). */
export function bingItem(i: { title: string; link: string; pubDate?: string }): FeedItem | undefined {
  try {
    const real = new URL(i.link).searchParams.get("url");
    if (!real) return undefined;
    const published = i.pubDate && !Number.isNaN(Date.parse(i.pubDate)) ? day(i.pubDate) : day(Date.now());
    return { url: real, title: i.title, outlet: new URL(real).hostname.replace(/^www\./, ""), published, kind: "news" };
  } catch {
    return undefined;
  }
}

export async function bing(): Promise<FeedItem[]> {
  if (process.env.USE_BING_NEWS !== "1") return [];
  const queries = [
    "THAAD interceptors stockpile",
    "Patriot interceptors stockpile",
    "Tomahawk missiles stockpile",
    "SM-6 SM-3 interceptors Navy",
    "JASSM stockpile",
    "munitions stockpile Iran war",
  ];
  const out: FeedItem[] = [];
  for (const q of queries) {
    try {
      for (const i of parseRss(await get(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`))) {
        const item = bingItem(i);
        if (item) out.push(item);
      }
    } catch (e) {
      console.warn(`bing: ${(e as Error).message}`);
    }
  }
  return out;
}

/**
 * Daily DoD contract announcements: production news for the model's inputs.
 * Not in the default watch: war.gov serves the RSS feed but answers 403 to
 * article requests from cloud IPs (GitHub's runners included).
 */
export async function contracts(): Promise<FeedItem[]> {
  const items = parseRss(
    await get("https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=400&Site=945&max=10"),
  );
  return items.map((i) => ({
    url: i.link,
    title: i.title,
    outlet: "U.S. Department of War",
    published: i.pubDate ? day(i.pubDate) : day(Date.now()),
    kind: "government" as const,
    lead: true,
  }));
}

/**
 * GDELT's free news index returns publisher URLs directly (Google News RSS
 * only gives opaque redirect links). It allows one request per 5 seconds.
 */
export async function gdelt(): Promise<FeedItem[]> {
  const queries = [
    '(THAAD OR "Patriot interceptors" OR "PAC-3") (stockpile OR inventory OR interceptors)',
    '(Tomahawk OR JASSM OR "Precision Strike Missile") (stockpile OR inventory OR expended)',
    '("SM-3" OR "SM-6" OR "Standard Missile") (stockpile OR inventory OR interceptors)',
    '"munitions stockpile" Iran',
  ];
  const out: FeedItem[] = [];
  for (const q of queries) {
    const target = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${q} sourcelang:english`)}&mode=artlist&format=json&maxrecords=50&timespan=3d&sort=datedesc`;
    try {
      // GDELT rate-limits shared cloud IPs hard; one patient retry, then move on.
      const body = await get(target).catch(async (e: Error) => {
        if (!/HTTP 429/.test(e.message)) throw e;
        await sleep(20_000);
        return get(target);
      });
      const data = JSON.parse(body) as {
        articles?: { url: string; title: string; domain: string; seendate: string }[];
      };
      for (const a of data.articles ?? []) {
        const s = a.seendate; // 20261013T120000Z
        out.push({
          url: a.url,
          title: a.title,
          outlet: a.domain.replace(/^www\./, ""),
          published: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`,
          kind: "news",
        });
      }
    } catch (e) {
      console.warn(`gdelt: ${(e as Error).message}`);
    }
    await sleep(6000);
  }
  return out;
}

/**
 * The New York Times Article Search API (free key from developer.nytimes.com).
 * NYT pages are paywalled, so items carry the abstract and lead paragraph;
 * the resulting report is flagged for a manual quote check.
 */
export async function nyt(apiKey: string | undefined): Promise<FeedItem[]> {
  if (!apiKey) return [];
  const since = day(Date.now() - 4 * 86_400_000).replace(/-/g, "");
  const q = encodeURIComponent("missile stockpile OR interceptors OR munitions Iran");
  const url = `https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${q}&begin_date=${since}&sort=newest&api-key=${apiKey}`;
  try {
    const data = JSON.parse(await get(url));
    return (data.response?.docs ?? []).map(
      (d: {
        web_url: string;
        headline?: { main?: string };
        abstract?: string;
        lead_paragraph?: string;
        snippet?: string;
        pub_date: string;
      }) => ({
        url: d.web_url,
        title: d.headline?.main ?? "",
        outlet: "The New York Times",
        published: day(d.pub_date),
        abstract: [d.abstract, d.lead_paragraph ?? d.snippet].filter(Boolean).join("\n\n"),
        kind: "news" as const,
      }),
    );
  } catch (e) {
    console.warn(`nyt: ${(e as Error).message}`);
    return [];
  }
}
