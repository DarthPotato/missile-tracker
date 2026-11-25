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

/**
 * Posts newer than `afterId`, oldest first. Pages back at most `maxPages`
 * pages, so a first run (or a long outage) doesn't crawl the whole channel.
 */
export async function fetchChannel(handle: string, afterId: number, maxPages = 3): Promise<Post[]> {
  const seen = new Map<number, Post>();
  let before: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const url = `https://t.me/s/${handle}${before ? `?before=${before}` : ""}`;
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const posts = parseChannelPage(await res.text(), handle);
    if (!posts.length) break;
    for (const p of posts) if (p.id > afterId) seen.set(p.id, p);
    const oldest = posts[0].id;
    if (oldest <= afterId) break;
    before = oldest;
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
