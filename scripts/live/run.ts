// Live intercept feed. Several times a day: read the Telegram channels and news
// queries in data/live/sources.json, have Claude Haiku log intercept counts,
// throw out anything not quoted verbatim, merge into data/live/events.json.
//
// Unlike the stockpile watch, this publishes without a review step: the site
// labels every figure as unverified and keeps it out of the vetted numbers.
//
//   npm run live-feed                 normal run (needs ANTHROPIC_API_KEY)
//   npm run live-feed -- --dry-run    fetch and filter only, no Claude calls, no writes
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../load-node.ts";
import { LiveFile, mergeEvents } from "../../src/lib/live.ts";
import { parseRss, bingItem } from "../pipeline/feeds.ts";
import { fetchChannel, looksLikeIntercept } from "./telegram.ts";
import { extractEvents, type Item } from "./extract.ts";

const DIR = path.join(ROOT, "data", "live");
const EVENTS = path.join(DIR, "events.json");
const STATE = path.join(DIR, "state.json");
const OUT = path.join(ROOT, "pipeline-out");
/** Keep the log to a rolling window so the file stays small. */
const KEEP_DAYS = 180;
const BATCH = 15;
const dryRun = process.argv.includes("--dry-run");

interface Sources {
  telegram: { handle: string; name: string; official: boolean }[];
  newsQueries: string[];
}
interface State {
  lastPost: Record<string, number>;
  seenNews: string[];
}

const read = <T>(file: string, fallback: T): T =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;

async function news(queries: string[], seen: Set<string>): Promise<Item[]> {
  if (process.env.USE_BING_NEWS !== "1") return [];
  const out: Item[] = [];
  for (const q of queries) {
    try {
      const res = await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const raw of parseRss(await res.text())) {
        const item = bingItem(raw);
        if (!item || seen.has(item.url) || out.some((o) => o.url === item.url)) continue;
        // Headline plus the feed's snippet: enough for a count, no page fetch needed.
        const text = [raw.title, raw.description?.replace(/<[^>]+>/g, " ")].filter(Boolean).join("\n");
        if (!looksLikeIntercept(text)) continue;
        out.push({
          kind: "news",
          name: item.outlet,
          url: item.url,
          posted: raw.pubDate ? new Date(raw.pubDate).toISOString() : new Date().toISOString(),
          official: false,
          text,
        });
      }
    } catch (e) {
      console.warn(`news "${q}": ${(e as Error).message}`);
    }
  }
  return out;
}

async function main() {
  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }
  const sources = read<Sources>(path.join(DIR, "sources.json"), { telegram: [], newsQueries: [] });
  const state = read<State>(STATE, { lastPost: {}, seenNews: [] });
  const log = LiveFile.parse(read(EVENTS, { updated: null, events: [] }));
  const lines: string[] = [];

  const items: Item[] = [];
  const newLast: Record<string, number> = { ...state.lastPost };
  for (const ch of sources.telegram) {
    try {
      const posts = await fetchChannel(ch.handle, state.lastPost[ch.handle] ?? 0);
      const kept = posts.filter((p) => looksLikeIntercept(p.text));
      if (posts.length) newLast[ch.handle] = posts.at(-1)!.id;
      for (const p of kept)
        items.push({
          kind: "telegram",
          name: ch.name,
          url: p.url,
          posted: p.posted,
          official: ch.official,
          text: p.text,
        });
      lines.push(`- Telegram ${ch.name}: ${posts.length} new posts, ${kept.length} about intercepts`);
    } catch (e) {
      lines.push(`- Telegram ${ch.name}: failed (${(e as Error).message})`);
    }
  }
  const seenNews = new Set(state.seenNews);
  const newsItems = await news(sources.newsQueries, seenNews);
  items.push(...newsItems);
  lines.push(`- News: ${newsItems.length} new headlines about intercepts`);

  if (dryRun) {
    console.log(lines.join("\n"));
    for (const it of items)
      console.log(`  ${it.kind} ${it.name} ${it.posted} ${it.text.slice(0, 100).replace(/\n/g, " ")}`);
    return;
  }

  let added = 0;
  const dropped: string[] = [];
  let events = log.events;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    try {
      const res = await extractEvents(batch);
      const before = events.length;
      events = mergeEvents(events, res.events);
      added += res.events.length;
      lines.push(
        `- Batch ${i / BATCH + 1}: ${res.events.length} events (${events.length - before} new, rest merged as extra sources)`,
      );
      dropped.push(...res.dropped.map((d) => `  - ${d.item}: ${d.reason}`));
    } catch (e) {
      lines.push(`- Batch ${i / BATCH + 1}: extraction failed (${(e as Error).message})`);
    }
  }

  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  events = events.filter((e) => e.date >= cutoff);
  writeFileSync(EVENTS, JSON.stringify(LiveFile.parse({ updated: new Date().toISOString(), events }), null, 2) + "\n");
  for (const it of newsItems) seenNews.add(it.url);
  writeFileSync(STATE, JSON.stringify({ lastPost: newLast, seenNews: [...seenNews].slice(-500) }, null, 2) + "\n");

  mkdirSync(OUT, { recursive: true });
  const summary = [
    `Live feed run ${new Date().toISOString()}: ${added} events logged`,
    "",
    ...lines,
    ...(dropped.length ? ["", "Thrown out:", ...dropped] : []),
  ].join("\n");
  writeFileSync(path.join(OUT, "live-summary.md"), summary + "\n");
  console.log(summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
