// Past news headlines for a backfill, from the GDELT news archive. The regular news
// searches only reach back a day or two, so a launch count a government gave in
// March is out of their reach; GDELT keeps headlines going back years.
//
// Only headlines come back, no article text. That's enough here: statements like
// "UAE air defences intercepted 19 ballistic missiles and 26 drones" carry their
// counts in the headline, and the extractor still needs every count quoted verbatim.
import type { Item } from "./extract.ts";
import { looksLikeIntercept } from "./telegram.ts";

const API = "https://api.gdeltproject.org/api/v2/doc/doc";
/** GDELT asks for no more than one request every five seconds. */
const GAP_MS = 5_500;
const WEEK_MS = 7 * 86_400_000;

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
}

/** "20260402T123000Z" -> ISO timestamp. */
export function gdeltDate(s: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : undefined;
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);

/** Turn one GDELT artlist response into feed items, keeping English headlines about intercepts. */
export function archiveItems(json: unknown, seen: Set<string>): Item[] {
  const articles = (json as { articles?: GdeltArticle[] })?.articles ?? [];
  const out: Item[] = [];
  for (const a of articles) {
    const posted = a.seendate ? gdeltDate(a.seendate) : undefined;
    const title = a.title?.trim();
    if (!a.url?.startsWith("https://") || !title || !posted || !a.domain) continue;
    if (a.language && a.language !== "English") continue;
    if (seen.has(a.url) || out.some((o) => o.url === a.url) || !looksLikeIntercept(title)) continue;
    out.push({ kind: "news", name: a.domain.replace(/^www\./, ""), url: a.url, posted, official: false, text: title });
  }
  return out;
}

/** Search the archive week by week from `since` to now, for each query. */
export async function archiveNews(
  queries: string[],
  since: string,
  seen: Set<string>,
  log: (msg: string) => void = console.log,
): Promise<{ items: Item[]; failed: number }> {
  const items: Item[] = [];
  let failed = 0;
  const start = Date.parse(since);
  for (const q of queries) {
    for (let from = start; from < Date.now(); from += WEEK_MS) {
      const to = Math.min(from + WEEK_MS, Date.now());
      const url =
        `${API}?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=250&sort=datedesc` +
        `&startdatetime=${stamp(from)}&enddatetime=${stamp(to)}`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        // GDELT answers a bad query or a rate limit with plain text, not JSON.
        const got = archiveItems(body.trim().startsWith("{") ? JSON.parse(body) : {}, seen).filter(
          (it) => !items.some((o) => o.url === it.url),
        );
        items.push(...got);
        log(`archive "${q}" ${new Date(from).toISOString().slice(0, 10)}: ${got.length} headlines`);
      } catch (e) {
        failed++;
        log(`archive "${q}" ${new Date(from).toISOString().slice(0, 10)}: failed (${(e as Error).message})`);
      }
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }
  return { items, failed };
}
