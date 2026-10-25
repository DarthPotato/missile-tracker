// Add or replace a missile's photo from a DVIDS image page:
//   npm run add-photo -- <munition-id> <dvids-image-url> ["alt text"]
// Downloads DVIDS's 2,000px public preview (no login needed) to
// src/assets/photos/<munition>.jpg and records caption, credit and date in
// data/photos.json. Refuses anything not marked public domain.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MUNITION_IDS, PhotosFile, type MunitionId } from "../src/lib/schema.ts";
import { htmlToText } from "../src/lib/text.ts";
import { ROOT } from "./load-node.ts";

const UA = "Mozilla/5.0 (compatible; missile-tracker/0.1; +https://github.com/DarthPotato/missile-tracker)";

export interface DvidsPhoto {
  dvidsId: string;
  imageUrl: string;
  caption: string;
  credit: string;
  taken: string;
  publicDomain: boolean;
}

/**
 * Best credit line: a named photographer if the page or caption gives one
 * ("Photo by X", "(U.S. Space Force Photo by X)", "(DoD photo by U.S. Navy)"),
 * then the unit that posted it.
 */
export function creditFrom(byLine: string, unit: string, text: string): string {
  const who = byLine.replace(/^Photo by /, "").replace(/^Courtesy Photo$/, "");
  if (who) return [who, unit].filter(Boolean).join(", ");

  const at = text.search(/[Pp]hoto by /);
  if (at >= 0) {
    // "(U.S. Space Force Photo by Anthony Mendez)" / "(DoD photo by U.S. Navy. (Released))"
    const name = text
      .slice(at + "photo by ".length)
      .split(")")[0]
      .replace(/\.?\s*\(Released$/i, "")
      .replace(/\.$/, "")
      .trim();
    const agency = text.slice(text.lastIndexOf("(", at) + 1, at).trim();
    if (/^U\.S\./.test(name)) return name;
    return [name, agency && agency !== "DoD" ? agency : unit].filter(Boolean).join(", ");
  }
  const branch = text.match(/\((U\.S\. (?:Navy|Army|Air Force|Marine Corps|Space Force)) photo\)/i)?.[1];
  return [branch, unit].filter(Boolean).join(", ");
}

/** Pull the fields we need out of a DVIDS image page. Pure, so it can be tested on saved HTML. */
export function parseDvidsPage(html: string, pageUrl: string): DvidsPhoto {
  const dvidsId = pageUrl.match(/\/image\/(\d+)/)?.[1];
  if (!dvidsId) throw new Error(`not a DVIDS image URL: ${pageUrl}`);
  const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  if (!og) throw new Error("no og:image on the page");
  const lines = htmlToText(html)
    .split("\n")
    .map((l) => l.trim());
  const at = (pred: (l: string) => boolean) => lines.findIndex(pred);
  const byIdx = at((l) => /^Photo by /.test(l) || l === "Courtesy Photo");
  if (byIdx < 0) throw new Error("no photo credit found");
  const date = lines[byIdx - 1].match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!date) throw new Error("no date taken found");
  // The caption is the longest line between the credit block and "IMAGE INFO"
  // (a short "(DoD photo by ...)" line can sit just above IMAGE INFO).
  const info = at((l) => l === "IMAGE INFO");
  const block = info > byIdx ? lines.slice(byIdx + 2, info) : [];
  const caption = block.reduce((a, b) => (b.length > a.length ? b : a), "");
  const credit = creditFrom(lines[byIdx], lines[byIdx + 1] ?? "", block.join(" "));
  return {
    dvidsId,
    imageUrl: og.replace(/\/\d+w_q95\.jpg$/, "/2000w_q95.jpg"),
    caption,
    credit,
    taken: `${date[3]}-${date[1]}-${date[2]}`,
    publicDomain: /PUBLIC DOMAIN/.test(html),
  };
}

async function main() {
  const [munition, pageUrl, altArg] = process.argv.slice(2);
  if (!(MUNITION_IDS as readonly string[]).includes(munition) || !pageUrl) {
    console.error(`usage: npm run add-photo -- <${MUNITION_IDS.join("|")}> <dvids-image-url> ["alt text"]`);
    process.exit(2);
  }
  const html = await (await fetch(pageUrl, { headers: { "user-agent": UA } })).text();
  const p = parseDvidsPage(html, pageUrl);
  if (!p.publicDomain) throw new Error("this DVIDS image isn't marked public domain; pick another");

  const img = await fetch(p.imageUrl, { headers: { "user-agent": UA } });
  if (!img.ok || !(img.headers.get("content-type") ?? "").includes("image/jpeg")) {
    throw new Error(`couldn't download ${p.imageUrl} (HTTP ${img.status})`);
  }
  const out = path.join(ROOT, "src", "assets", "photos", `${munition}.jpg`);
  writeFileSync(out, Buffer.from(await img.arrayBuffer()));

  const file = path.join(ROOT, "data", "photos.json");
  const photos = PhotosFile.parse(JSON.parse(readFileSync(file, "utf8")));
  photos[munition as MunitionId] = {
    dvidsId: p.dvidsId,
    sourceUrl: `https://www.dvidshub.net/image/${p.dvidsId}`,
    alt: altArg ?? p.caption.split(/(?<=\.)\s/)[0],
    caption: p.caption,
    credit: p.credit,
    taken: p.taken,
    license: "public-domain",
  };
  writeFileSync(file, `${JSON.stringify(PhotosFile.parse(photos), null, 2)}\n`);
  console.log(
    `${munition}: ${p.credit}, ${p.taken}\n  ${p.caption.slice(0, 120)}…\n  saved ${path.relative(ROOT, out)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => (console.error(e.message), process.exit(1)));
