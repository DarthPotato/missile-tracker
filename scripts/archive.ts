// Archived copies of sources on the Internet Archive's Wayback Machine.
//
// News pages get edited, paywalled or deleted, and some sites (CSIS, the
// Pentagon) refuse GitHub's servers. Each report keeps a Wayback snapshot next
// to its original link, so every quote stays checkable: the quote check falls
// back to the snapshot when the original can't be fetched.
//
//   npm run archive-sources              archive every report that has no snapshot yet
//   npm run archive-sources -- --dry-run look up only, write nothing
import { readFileSync, readdirSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const UA = "Mozilla/5.0 (compatible; missile-tracker/0.1; +https://github.com/DarthPotato/missile-tracker) archiver";
const SNAPSHOT = /^https?:\/\/web\.archive\.org\/web\/(\d{14})(?:id_)?\/(.+)$/;

/** Normalise a snapshot address to https://web.archive.org/web/<14-digit timestamp>/<original>. */
export function canonicalSnapshot(url: string): string | undefined {
  const m = url.match(SNAPSHOT);
  return m ? `https://web.archive.org/web/${m[1]}/${m[2]}` : undefined;
}

/** The raw page as it was archived, without the Wayback toolbar or rewritten links. */
export function rawSnapshot(archiveUrl: string): string {
  const m = archiveUrl.match(SNAPSHOT);
  if (!m) throw new Error(`not a Wayback snapshot: ${archiveUrl}`);
  return `https://web.archive.org/web/${m[1]}id_/${m[2]}`;
}

/** An existing snapshot that loaded fine, closest to `published` (YYYY-MM-DD). */
export async function findSnapshot(
  url: string,
  published: string,
  fetcher: Fetcher = fetch,
): Promise<string | undefined> {
  const q = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}&timestamp=${published.replace(/-/g, "")}`;
  const res = await fetcher(q, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`availability lookup: HTTP ${res.status}`);
  const json = (await res.json()) as {
    archived_snapshots?: { closest?: { available?: boolean; url?: string; status?: string } };
  };
  const c = json.archived_snapshots?.closest;
  if (!c?.available || !c.url || (c.status && c.status !== "200")) return undefined;
  return canonicalSnapshot(c.url);
}

/** Ask the Wayback Machine to save the page now; returns the new snapshot. */
export async function saveSnapshot(url: string, fetcher: Fetcher = fetch): Promise<string | undefined> {
  const res = await fetcher(`https://web.archive.org/save/${url}`, {
    headers: { "user-agent": UA },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`save: HTTP ${res.status}`);
  const loc = res.headers.get("content-location");
  return canonicalSnapshot(res.url) ?? (loc ? canonicalSnapshot(`https://web.archive.org${loc}`) : undefined);
}

/** An existing snapshot if there is one, else a fresh save. */
export async function archive(url: string, published: string, fetcher: Fetcher = fetch): Promise<string | undefined> {
  return (await findSnapshot(url, published, fetcher)) ?? (await saveSnapshot(url, fetcher));
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dir = path.join(root, "data", "reports");
  const dryRun = process.argv.includes("--dry-run");
  const lines: string[] = [];
  let added = 0;
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const full = path.join(dir, file);
    const report = JSON.parse(readFileSync(full, "utf8"));
    if (report.source.archiveUrl) continue;
    try {
      const snap = dryRun
        ? await findSnapshot(report.source.url, report.source.published)
        : await archive(report.source.url, report.source.published);
      if (!snap) {
        lines.push(`- ${report.id}: no snapshot yet`);
        continue;
      }
      lines.push(`- ${report.id}: ${snap}`);
      if (!dryRun) {
        // Keep key order: archiveUrl sits right after url.
        const source: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(report.source)) {
          source[k] = v;
          if (k === "url") source.archiveUrl = snap;
        }
        report.source = source;
        // Format as the repo does, so the lint check stays green.
        const options = { ...(await resolveConfig(full)), filepath: full };
        writeFileSync(full, await format(JSON.stringify(report, null, 2), options));
        added++;
      }
    } catch (e) {
      lines.push(`- ${report.id}: failed (${(e as Error).message})`);
    }
    // The Save Page Now API asks anonymous callers to keep it slow.
    await new Promise((r) => setTimeout(r, dryRun ? 500 : 6000));
  }
  const summary = [`Archived ${added} source${added === 1 ? "" : "s"} on the Wayback Machine`, ...lines].join("\n");
  console.log(summary);
  // When run after the daily watch, add to its pull request summary.
  const out = path.join(root, "pipeline-out");
  if (!dryRun && added && existsSync(path.join(out, "summary.md"))) {
    appendFileSync(path.join(out, "summary.md"), `\n### Archived copies\n\n${lines.join("\n")}\n`);
    writeFileSync(path.join(out, "has-changes"), "true");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
