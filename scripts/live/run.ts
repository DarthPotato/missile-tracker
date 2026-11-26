// Live intercept feed. Several times a day: read the Telegram channels and news
// queries in data/live/sources.json, have Claude Haiku log intercept counts,
// throw out anything not quoted verbatim, merge into data/live/events.json.
// Posts that name a U.S. MQ-9 or MQ-1 also go through a second pass that logs
// shoot-down claims into data/live/drone-claims.json.
//
// Unlike the stockpile watch, this publishes without a review step: the site
// labels every figure as unverified and keeps it out of the vetted numbers.
//
//   npm run live-feed                 normal run (needs ANTHROPIC_API_KEY)
//   npm run live-feed -- --dry-run    fetch and filter only, no Claude calls, no writes
//   BACKFILL_DAYS=30 npm run live-feed  also re-read the last 30 days of every
//                                       Telegram channel (news feeds only go back a day or two)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../load-node.ts";
import { LiveFile, mergeEvents } from "../../src/lib/live.ts";
import { parseRss, bingItem } from "../pipeline/feeds.ts";
import { fetchChannel, looksLikeIntercept, looksLikeTally, worthSending } from "./telegram.ts";
import { extractEvents, type Item } from "./extract.ts";
import { extractClaims, mentionsUsAircraft } from "./losses.ts";
import { DroneClaimsFile, mergeClaims } from "../../src/lib/drones.ts";

const DIR = path.join(ROOT, "data", "live");
const EVENTS = path.join(DIR, "events.json");
const CLAIMS = path.join(DIR, "drone-claims.json");
const STATE = path.join(DIR, "state.json");
const OUT = path.join(ROOT, "pipeline-out");
// The log keeps everything: it's the history. No rolling window.
const BATCH = 15;
const dryRun = process.argv.includes("--dry-run");
const backfillDays = Number(process.env.BACKFILL_DAYS || 0);

interface Sources {
  telegram: { handle: string; name: string; official: boolean; dronesOnly?: boolean }[];
  newsQueries: string[];
  /** Searches for U.S. drone shoot-down claims; only headlines naming an MQ-9, MQ-1 or U.S. jet are kept. */
  droneQueries?: string[];
}
interface State {
  lastPost: Record<string, number>;
  seenNews: string[];
}

const read = <T>(file: string, fallback: T): T =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;

async function news(
  queries: string[],
  seen: Set<string>,
  keep: (text: string) => boolean = looksLikeIntercept,
): Promise<Item[]> {
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
        if (!keep(text)) continue;
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
  const claimLog = DroneClaimsFile.parse(read(CLAIMS, { updated: null, claims: [] }));
  const droneItems: Item[] = [];
  const lines: string[] = [];

  const items: Item[] = [];
  const newLast: Record<string, number> = { ...state.lastPost };
  const since = backfillDays > 0 ? new Date(Date.now() - backfillDays * 86_400_000).toISOString() : undefined;
  if (since) lines.push(`- Backfill: re-reading Telegram back to ${since.slice(0, 10)}`);
  for (const ch of sources.telegram) {
    try {
      const posts = since
        ? await fetchChannel(ch.handle, 0, { since })
        : await fetchChannel(ch.handle, state.lastPost[ch.handle] ?? 0);
      // A drones-only channel feeds the Reaper claim log and nothing else, so its
      // posts never reach the intercept extractor.
      const kept = ch.dronesOnly ? [] : posts.filter((p) => worthSending(p.text, ch.official));
      if (posts.length) newLast[ch.handle] = Math.max(newLast[ch.handle] ?? 0, posts.at(-1)!.id);
      const aboutDrones = posts.filter((p) => mentionsUsAircraft(p.text));
      for (const p of aboutDrones)
        droneItems.push({
          kind: "telegram",
          name: ch.name,
          url: p.url,
          posted: p.posted,
          official: ch.official,
          text: p.text,
          video: p.video,
        });
      for (const p of kept)
        items.push({
          kind: "telegram",
          name: ch.name,
          url: p.url,
          posted: p.posted,
          official: ch.official,
          text: p.text,
        });
      const tallies = kept.filter((p) => looksLikeTally(p.text)).length;
      lines.push(
        ch.dronesOnly
          ? `- Telegram ${ch.name}: ${posts.length} new posts (read for drone claims only)`
          : ch.official
            ? `- Telegram ${ch.name}: ${posts.length} new posts, ${kept.length} giving a number shot down (sent)`
            : `- Telegram ${ch.name}: ${posts.length} new posts, ${kept.length} about intercepts, ${tallies} giving a number shot down`,
        ...(aboutDrones.length ? [`  - ${aboutDrones.length} naming an MQ-9, MQ-1 or U.S. jet`] : []),
      );
    } catch (e) {
      lines.push(`- Telegram ${ch.name}: failed (${(e as Error).message})`);
    }
  }
  const seenNews = new Set(state.seenNews);
  const newsItems = await news(sources.newsQueries, seenNews);
  items.push(...newsItems);
  lines.push(`- News: ${newsItems.length} new headlines about intercepts`);
  const droneNews = (await news(sources.droneQueries ?? [], seenNews, mentionsUsAircraft)).filter(
    (d) => !newsItems.some((n) => n.url === d.url),
  );
  // Intercept headlines that name a Reaper count too.
  droneItems.push(...droneNews, ...newsItems.filter((n) => mentionsUsAircraft(n.text)));
  lines.push(`- News: ${droneNews.length} new headlines naming an MQ-9, MQ-1 or U.S. jet`);

  if (dryRun) {
    console.log(lines.join("\n"));
    for (const it of items)
      console.log(`  ${it.kind} ${it.name} ${it.posted} ${it.text.slice(0, 100).replace(/\n/g, " ")}`);
    for (const it of droneItems)
      console.log(`  drone ${it.kind} ${it.name} ${it.posted} ${it.text.slice(0, 100).replace(/\n/g, " ")}`);
    return;
  }

  let added = 0;
  const dropped: string[] = [];
  const cited = new Set<string>();
  let events = log.events;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    try {
      const res = await extractEvents(batch);
      for (const e of res.events) for (const s of e.sources) cited.add(s.url);
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

  // Official posts that state a number shot down should always become an event.
  // List the ones that didn't, so a miss shows up in the run summary.
  const missed = items.filter((it) => it.official && looksLikeTally(it.text) && !cited.has(it.url));
  const bySource = new Map<string, number>();
  for (const it of items) if (cited.has(it.url)) bySource.set(it.name, (bySource.get(it.name) ?? 0) + 1);
  lines.push(
    `- Items that produced events: ${[...bySource].map(([n, c]) => `${n} ${c}`).join(", ") || "none"}`,
    ...(missed.length
      ? [
          `- Official posts giving a number that produced no event (${missed.length}):`,
          ...missed.map((m) => `  - ${m.url}`),
        ]
      : []),
  );
  let claims = claimLog.claims;
  let claimed = 0;
  for (let i = 0; i < droneItems.length; i += BATCH) {
    const batch = droneItems.slice(i, i + BATCH);
    try {
      const res = await extractClaims(batch);
      const before = claims.length;
      claims = mergeClaims(claims, res.claims);
      claimed += res.claims.length;
      lines.push(
        `- Drone batch ${i / BATCH + 1}: ${res.claims.length} shoot-down claims (${claims.length - before} new, rest merged as extra sources)`,
      );
      dropped.push(...res.dropped.map((d) => `  - ${d.item}: ${d.reason}`));
    } catch (e) {
      lines.push(`- Drone batch ${i / BATCH + 1}: extraction failed (${(e as Error).message})`);
    }
  }
  if (droneItems.length || !claimLog.updated)
    writeFileSync(
      CLAIMS,
      JSON.stringify(DroneClaimsFile.parse({ updated: new Date().toISOString(), claims }), null, 2) + "\n",
    );

  writeFileSync(EVENTS, JSON.stringify(LiveFile.parse({ updated: new Date().toISOString(), events }), null, 2) + "\n");
  for (const it of [...newsItems, ...droneNews]) seenNews.add(it.url);
  writeFileSync(STATE, JSON.stringify({ lastPost: newLast, seenNews: [...seenNews].slice(-500) }, null, 2) + "\n");

  mkdirSync(OUT, { recursive: true });
  const summary = [
    `Live feed run ${new Date().toISOString()}: ${added} events logged, ${claimed} drone shoot-down claims`,
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
