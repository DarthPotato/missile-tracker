// npm run validate                       schema + cross-reference checks (offline)
// npm run validate -- --quotes           also fetch every "auto" source and confirm each
//                                        quote appears on the page verbatim
//
// Options for --quotes:
//   --only <id,id,...>         check just these reports ("perspective" for that page)
//   --changed <path,path,...>  pull-request mode: sources tied to these changed files
//                              must be reachable; others may be unreachable
//   --allow-unreachable        escape hatch for known-flaky hosts or offline runs:
//                              unreachable sources warn instead of failing
//
// Missing quotes always fail. With no options every source must be reachable,
// and a run where no source at all can be fetched fails unless --allow-unreachable.
import { readFileSync } from "node:fs";
import path from "node:path";
import { DataError } from "../src/lib/dataset.ts";
import { PerspectiveFile } from "../src/lib/schema.ts";
import { fetchText } from "./fetch-text.ts";
import { loadDataset, ROOT } from "./load-node.ts";
import { checkQuotes, quoteTargets, strictIdsFromChanged, summarize } from "./quotes.ts";

function listArg(name: string): string[] | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v.split(/[\s,]+/).filter(Boolean) : [];
}

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

  const only = listArg("only");
  const changed = listArg("changed");
  const allowUnreachable = process.argv.includes("--allow-unreachable");

  let targets = quoteTargets(ds, p.data);
  if (only) targets = targets.filter((t) => only.includes(t.id));
  const strictIds = changed ? strictIdsFromChanged(changed, ds) : undefined;
  const strict = (id: string) => !allowUnreachable && (strictIds ? strictIds.has(id) : true);

  const r = await checkQuotes(targets, fetchText, { strict, allowNoneReachable: allowUnreachable });
  for (const id of new Set(r.manual)) console.log(`skip  ${id} (manual quote check)`);
  for (const u of r.unreachable) {
    console[u.strict ? "error" : "warn"](`${u.strict ? "FAIL" : "warn"}  ${u.id}: could not fetch ${u.url} (${u.error})`);
  }
  for (const m of r.missing) console.error(`FAIL  ${m.id}: quote not found: "${m.quote.slice(0, 90)}…"`);
  console.log(summarize(r));
  if (!r.ok) process.exit(1);
}

main();
