// Add one source by hand, e.g. a paywalled story you can read:
//   npm run add-source -- <url> [--outlet "The New York Times"] [--title "..."]
//                              [--published 2026-10-12] [--text-file story.txt]
// Without --text-file the page is fetched. With it, paste the article text into
// a file; the report is marked for a manual quote check since the page itself
// can't be fetched to confirm it.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchText } from "../fetch-text.ts";
import { REPORTS_DIR } from "../load-node.ts";
import { describeClaim, SHORT_NAME } from "../../src/lib/describe.ts";
import { extract } from "./extract.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.argv[2];
  if (!url || url.startsWith("--")) {
    console.error("usage: npm run add-source -- <url> [--outlet X] [--title X] [--published YYYY-MM-DD] [--text-file F]");
    process.exit(2);
  }
  const textFile = arg("text-file");
  const text = textFile ? readFileSync(textFile, "utf8") : await fetchText(url);
  const host = new URL(url).hostname.replace(/^www\./, "");
  const result = await extract({
    url,
    text,
    outlet: arg("outlet") ?? host,
    title: arg("title") ?? text.split("\n")[0].slice(0, 160),
    published: arg("published") ?? new Date().toISOString().slice(0, 10),
    partial: !!textFile,
  });

  for (const d of result.dropped) console.warn(`dropped: "${d.quote.slice(0, 100)}" (${d.reason})`);
  if (!result.report) {
    console.log(`Nothing to add: ${result.summary}`);
    return;
  }
  const file = path.join(REPORTS_DIR, `${result.report.id}.json`);
  writeFileSync(file, `${JSON.stringify(result.report, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), file)}\n${result.summary}`);
  for (const c of result.report.claims) {
    console.log(`  ${SHORT_NAME[c.munition]}: ${c.metric === "statement" ? "statement" : describeClaim(c)} (as of ${c.asOf}, ${c.confidence})`);
  }
  console.log("Check the outlet, title and date fields, then run `npm run validate`.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
