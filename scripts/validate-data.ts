// npm run validate                 schema + cross-reference checks (offline)
// npm run validate -- --quotes     also fetch every "auto" source and confirm
//                                  each quote appears on the page verbatim
import { DataError, sourcedParams } from "../src/lib/dataset.ts";
import { containsQuote } from "../src/lib/text.ts";
import { fetchText } from "./fetch-text.ts";
import { loadDataset, ROOT } from "./load-node.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PerspectiveFile } from "../src/lib/schema.ts";

async function main() {
  let ds;
  try {
    ds = loadDataset();
  } catch (e) {
    if (e instanceof DataError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  const p = PerspectiveFile.safeParse(JSON.parse(readFileSync(path.join(ROOT, "data", "perspective.json"), "utf8")));
  if (!p.success) {
    console.error(`perspective.json: ${p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    process.exit(1);
  }
  const claims = ds.reports.reduce((n, r) => n + r.claims.length, 0);
  console.log(`ok: ${ds.munitions.length} munitions, ${ds.reports.length} reports, ${claims} claims`);

  if (!process.argv.includes("--quotes")) return;

  let failures = 0;
  for (const r of ds.reports) {
    if (r.quoteCheck === "manual") {
      console.log(`skip  ${r.id} (manual quote check)`);
      continue;
    }
    let text: string;
    try {
      text = await fetchText(r.source.url);
    } catch (e) {
      console.warn(`warn  ${r.id}: could not fetch (${(e as Error).message})`);
      continue;
    }
    const quotes = [
      ...r.claims.map((c) => c.quote),
      ...ds.munitions.flatMap((m) => sourcedParams(m).filter((p) => p.reportId === r.id).map((p) => p.quote)),
    ];
    const missing = [...new Set(quotes)].filter((q) => !containsQuote(text, q));
    if (missing.length) {
      failures += missing.length;
      for (const q of missing) console.error(`FAIL  ${r.id}: quote not found: "${q.slice(0, 90)}…"`);
    } else {
      console.log(`ok    ${r.id}: ${quotes.length} quotes found on page`);
    }
  }
  // The perspective page's figures get the same check.
  const figures = [
    ...p.data.amounts.flatMap((a) => (a.source ? [a.source] : [])),
    ...p.data.comparisons.map((c) => c.source),
  ];
  for (const f of figures) {
    if (f.quoteCheck === "manual") continue;
    try {
      const ok = containsQuote(await fetchText(f.url), f.quote);
      if (!ok) failures++;
      console[ok ? "log" : "error"](`${ok ? "ok  " : "FAIL"}  perspective: ${f.outlet}`);
    } catch (e) {
      console.warn(`warn  perspective ${f.outlet}: could not fetch (${(e as Error).message})`);
    }
  }
  if (failures) process.exit(1);
}

main();
