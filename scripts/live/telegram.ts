// Read a public Telegram channel through its web preview (t.me/s/<handle>).
// No account, bot or API key: these are the same pages anyone can open in a
// browser. Each page holds the newest ~20 posts; ?before=<id> pages back.
import { htmlToText } from "../../src/lib/text.ts";

export interface Post {
  handle: string;
  id: number;
  url: string;
  /** ISO timestamp from the post's <time datetime>. */
  posted: string;
  text: string;
}

const UA = "Mozilla/5.0 (compatible; missile-tracker/0.1; +https://github.com/DarthPotato/missile-tracker) live-feed";

/** Parse a t.me/s/<handle> page into posts, oldest first. Posts without text (photos only) are skipped. */
export function parseChannelPage(html: string, handle: string): Post[] {
  const posts: Post[] = [];
  const chunks = html.split(/(?=<div class="tgme_widget_message_wrap)/);
  for (const chunk of chunks) {
    const post = chunk.match(/data-post="([^"/]+)\/(\d+)"/);
    if (!post || post[1].toLowerCase() !== handle.toLowerCase()) continue;
    const body = chunk.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const time = chunk.match(/<time[^>]*datetime="([^"]+)"/);
    if (!body || !time) continue;
    const text = htmlToText(body[1]);
    if (!text) continue;
    const id = Number(post[2]);
    posts.push({ handle, id, url: `https://t.me/${handle}/${id}`, posted: time[1], text });
  }
  return posts.sort((a, b) => a.id - b.id);
}

export interface FetchOptions {
  /** Stop after this many pages (about 20 posts each). */
  maxPages?: number;
  /** Backfill: keep paging back until posts are older than this ISO date, ignoring maxPages' default. */
  since?: string;
}

/**
 * Posts newer than `afterId` (and on or after `since`, when given), oldest
 * first. A normal run pages back at most 3 pages, so a first run or a long
 * outage doesn't crawl the whole channel; a backfill pages back to `since`.
 */
export async function fetchChannel(handle: string, afterId: number, opts: FetchOptions = {}): Promise<Post[]> {
  const { since } = opts;
  const maxPages = opts.maxPages ?? (since ? 400 : 3);
  const seen = new Map<number, Post>();
  let before: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const url = `https://t.me/s/${handle}${before ? `?before=${before}` : ""}`;
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const posts = parseChannelPage(await res.text(), handle);
    if (!posts.length) break;
    for (const p of posts) if (p.id > afterId && (!since || p.posted >= since)) seen.set(p.id, p);
    const oldest = posts[0];
    if (oldest.id <= afterId || (since && oldest.posted < since)) break;
    before = oldest.id;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return [...seen.values()].sort((a, b) => a.id - b.id);
}

/** Cheap filter before spending a model call: does the post talk about shooting things down? */
const INTERCEPT_WORDS =
  /(intercept|shot down|shoot down|downed|neutrali[sz]ed|destroyed|air defen[cs]e|drones?|uav|shahed|ballistic|cruise missile|збито|збили|подавлено|знешкоджено|БпЛА|ракет)/i;

export function looksLikeIntercept(text: string): boolean {
  return INTERCEPT_WORDS.test(text);
}

/** A post that states a number shot down: what an official morning tally looks like. */
export function looksLikeTally(text: string): boolean {
  return /(збито|подавлено|shot down|intercepted|downed)/i.test(text) && /\d/.test(text);
}

/**
 * Whether a post is worth a model call. An official channel like Ukraine's Air
 * Force posts dozens of live threat alerts a day ("drones heading for Sumy")
 * and one morning tally; only posts that give a number shot down can become an
 * event, so official channels send just those. Other channels often write
 * counts as words ("three drones"), so they keep the looser filter.
 */
export function worthSending(text: string, official: boolean): boolean {
  return looksLikeIntercept(text) && (!official || looksLikeTally(text));
}
