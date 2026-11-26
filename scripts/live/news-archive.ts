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
/**
 * GDELT asks for no more than one request every five seconds, and counts by IP. A
 * GitHub runner shares its address with other jobs, so leave more room than that
 * and back off when it says no.
 */
const GAP_MS = 8_000;
const RETRY_MS = [20_000, 40_000, 80_000];
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
  opts: { budgetMinutes?: number; wait?: (ms: number) => Promise<void>; get?: typeof fetch } = {},
): Promise<{ items: Item[]; failed: number; skipped: number }> {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const get = opts.get ?? fetch;
  const until = Date.now() + (opts.budgetMinutes ?? 120) * 60_000;
  const items: Item[] = [];
  let failed = 0;
  let skipped = 0;
  const start = Date.parse(since);
  /** One search, tried again after a rate limit or a dropped connection. */
  const search = async (url: string): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await get(url);
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { final: true });
        const body = await res.text();
        // GDELT answers a bad query with plain text, not JSON.
        return body.trim().startsWith("{") ? JSON.parse(body) : {};
      } catch (e) {
        if ((e as { final?: boolean }).final || attempt >= RETRY_MS.length) throw e;
        await wait(RETRY_MS[attempt]);
      }
    }
  };
  for (const q of queries) {
    for (let from = start; from < Date.now(); from += WEEK_MS) {
      if (Date.now() > until) {
        skipped++;
        continue;
      }
      const to = Math.min(from + WEEK_MS, Date.now());
      const url =
        `${API}?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=250&sort=datedesc` +
        `&startdatetime=${stamp(from)}&enddatetime=${stamp(to)}`;
      try {
        const got = archiveItems(await search(url), seen).filter((it) => !items.some((o) => o.url === it.url));
        items.push(...got);
        log(`archive "${q}" ${new Date(from).toISOString().slice(0, 10)}: ${got.length} headlines`);
      } catch (e) {
        failed++;
        log(`archive "${q}" ${new Date(from).toISOString().slice(0, 10)}: failed (${(e as Error).message})`);
      }
      await wait(GAP_MS);
    }
  }
  return { items, failed, skipped };
}
