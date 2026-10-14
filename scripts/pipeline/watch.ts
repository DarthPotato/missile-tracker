// Daily watcher. Pulls the feeds, keeps items that look like stockpile news,
// drafts reports for them with Claude, and writes:
//   data/reports/<id>.json       one draft per article with verified claims
//   data/pipeline-state.json     URLs already looked at
//   pipeline-out/summary.md      the pull request body
// The GitHub Action opens a PR with these changes for a human to review.
//
//   npm run watch-sources                 normal run (needs ANTHROPIC_API_KEY)
//   npm run watch-sources -- --dry-run    list candidates, no Claude calls, no writes
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchText } from "../fetch-text.ts";
import { loadDataset, REPORTS_DIR, ROOT } from "../load-node.ts";
import { describeClaim, SHORT_NAME } from "../../src/lib/describe.ts";
import { extract, type Article } from "./extract.ts";
import { applyToFile } from "./inputs.ts";
import { canonical } from "./urls.ts";
import { checkQuotes, healthLines, quoteTargets } from "../quotes.ts";
import { PerspectiveFile } from "../../src/lib/schema.ts";
import { bing, csis, gdelt, looksRelevant, nyt, type FeedItem } from "./feeds.ts";

const STATE_FILE = path.join(ROOT, "data", "pipeline-state.json");
const OUT_DIR = path.join(ROOT, "pipeline-out");
const MAX_ARTICLES = Number(process.env.MAX_ARTICLES ?? 12);
const LOOKBACK_DAYS = 7;
const dryRun = process.argv.includes("--dry-run");

type State = { seen: Record<string, string> };

function loadState(): State {
  if (!existsSync(STATE_FILE)) return { seen: {} };
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

async function main() {
  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. In GitHub: Settings → Secrets and variables → Actions → Repository secrets.",
    );
    process.exit(1);
  }
  const ds = loadDataset();
  const state = loadState();
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const known = new Set(ds.reports.flatMap((r) => [r.source.url, ...(r.source.altUrls ?? [])].map(canonical)));

  const settled = await Promise.allSettled([csis(), nyt(process.env.NYT_API_KEY), gdelt(), bing()]);
  const items: FeedItem[] = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  for (const s of settled) if (s.status === "rejected") console.warn(`feed failed: ${s.reason}`);

  const fresh = new Map<string, FeedItem>();
  for (const item of items) {
    let url: string;
    try {
      url = canonical(item.url);
    } catch {
      continue;
    }
    if (item.published < cutoff || state.seen[url] || known.has(url) || fresh.has(url)) continue;
    if (!item.lead && !item.undated && !looksRelevant(`${item.title} ${item.abstract ?? ""}`)) continue;
    fresh.set(url, { ...item, url });
  }
  const candidates = [...fresh.values()].sort((a, b) => b.published.localeCompare(a.published));
  console.log(`${items.length} feed items, ${candidates.length} new candidates`);

  if (dryRun) {
    for (const c of candidates)
      console.log(`${c.published}  ${c.lead ? "[lead] " : ""}${c.outlet}: ${c.title}\n            ${c.url}`);
    return;
  }

  const drafted: string[] = [];
  const newIds: string[] = [];
  const leads: string[] = [];
  const skipped: string[] = [];
  const unreadable: string[] = [];
  let processed = 0;

  for (const item of candidates) {
    if (processed >= MAX_ARTICLES) break;
    // Mark seen up front; failures below un-mark it so tomorrow's run retries.
    state.seen[item.url] = today;

    let text: string | undefined;
    let partial = false;
    try {
      text = await fetchText(item.url);
    } catch (e) {
      if (item.abstract) {
        text = item.abstract;
        partial = true;
      } else {
        unreadable.push(`- [${item.title}](${item.url}) (${item.outlet}): ${(e as Error).message}`);
        delete state.seen[item.url];
        continue;
      }
    }

    if (item.lead) {
      // Contract days list hundreds of awards; only surface the ones naming a tracked missile.
      const hits = text
        .split(/\n+/)
        .filter(
          (p) => looksRelevant(p) || /\b(PAC-3|THAAD|Tomahawk|JASSM|SM-6|SM-3|Precision Strike Missile)\b/.test(p),
        );
      if (hits.length)
        leads.push(
          `- [${item.title}](${item.url})\n${hits
            .slice(0, 5)
            .map((h) => `  > ${h.slice(0, 400)}`)
            .join("\n")}`,
        );
      continue;
    }

    if (item.undated) {
      const m = text.match(
        /Published (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})/,
      );
      if (!m) continue;
      item.published = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`).toISOString().slice(0, 10);
      if (item.published < cutoff) continue;
      item.title = text.split("\n")[0].trim() || item.title;
    }
    if (!looksRelevant(text)) continue;
    processed++;
    const article: Article = {
      url: item.url,
      title: item.title,
      outlet: item.outlet,
      published: item.published,
      text,
      partial,
      kind: item.kind,
    };
    try {
      const result = await extract(article);
      const drops = result.dropped.map((d) => `  - dropped: "${d.quote.slice(0, 120)}" (${d.reason})`).join("\n");
      if (result.report) {
        const file = path.join(REPORTS_DIR, `${result.report.id}.json`);
        writeFileSync(file, `${JSON.stringify(result.report, null, 2)}\n`);
        newIds.push(result.report.id);
        const lines = result.report.claims.map(
          (c) =>
            `  - **${SHORT_NAME[c.munition]}** ${c.metric === "statement" ? "statement" : describeClaim(c)} (as of ${c.asOf}, ${c.confidence})`,
        );
        if (result.inputUpdates.length) {
          const { applied, rejected } = applyToFile(result.inputUpdates, result.report.id);
          for (const a of applied) {
            lines.push(
              `  - 🔧 **Model input:** ${SHORT_NAME[a.munition]} \`${a.field}\` ${a.previous ?? "(none)"} → **${a.value}** — "${a.quote}"`,
            );
          }
          for (const r of rejected)
            lines.push(
              `  - model input not applied: ${SHORT_NAME[r.update.munition]} \`${r.update.field}\` (${r.reason})`,
            );
        }
        drafted.push(
          `- [${item.title}](${item.url}) — ${item.outlet}, ${item.published}${partial ? " · ⚠️ abstract only, check quotes by hand" : ""}\n  ${result.summary}\n${lines.join("\n")}${drops ? `\n${drops}` : ""}`,
        );
      } else {
        skipped.push(`- [${item.title}](${item.url}): ${result.summary}${drops ? `\n${drops}` : ""}`);
      }
    } catch (e) {
      skipped.push(`- [${item.title}](${item.url}): extraction failed (${(e as Error).message})`);
      delete state.seen[item.url];
    }
  }

  // Forget URLs after 60 days so the state file stays small.
  const keepAfter = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  for (const [u, d] of Object.entries(state.seen)) if (d < keepAfter) delete state.seen[u];
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

  // Re-check the sources already on the site, without blocking: a page that
  // changed or vanished is reported for a human, never a reason to hold back
  // today's drafts. (CI still checks strictly when a PR touches a report.)
  const perspective = PerspectiveFile.parse(
    JSON.parse(readFileSync(path.join(ROOT, "data", "perspective.json"), "utf8")),
  );
  const health = await checkQuotes(quoteTargets(ds, perspective), fetchText, {
    strict: () => false,
    allowNoneReachable: true,
  });
  const broken = healthLines(health);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "new-reports.txt"), newIds.join("\n"));
  const section = (title: string, rows: string[]) => (rows.length ? `## ${title}\n\n${rows.join("\n")}\n\n` : "");
  const summary =
    `Automated source check for ${today}. Claude drafted these; every quote below was found verbatim on the source page (except where marked). Review each claim before merging.\n\n` +
    section(`Drafted reports (${drafted.length})`, drafted) +
    section("Contract announcements naming tracked missiles", leads) +
    section("Looked at, nothing to add", skipped) +
    section("Couldn't fetch (add by hand with `npm run add-source -- <url> --text-file <file>`)", unreadable) +
    section("Sources that changed or disappeared", broken);
  writeFileSync(path.join(OUT_DIR, "summary.md"), summary);
  writeFileSync(path.join(OUT_DIR, "has-changes"), drafted.length || leads.length ? "true" : "false");
  console.log(summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
